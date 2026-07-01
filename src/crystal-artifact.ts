import QRCode from "qrcode"
import { PNG } from "pngjs"
import jsQR from "jsqr"
import { Resvg } from "@resvg/resvg-js"
import { readFileSync, writeFileSync, mkdirSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { canonicalize, sha256 } from "./canon"
import type {
  ChronicleEntryV0,
  ChroniclePortfolioV0,
  CrystalArtifactV0,
  CrystalBuildInput,
  CrystalBuildResult,
  CrystalDefect,
  CrystalMutation,
  CrystalQrEnvelopeV0,
  CrystalMutationType,
  PortableProofObjectV0,
} from "./types"

export function computeMutationHash(type: CrystalMutationType, sourceRef: string): string {
  return `sha256:${sha256(canonicalize({ type, source_ref: sourceRef }))}`
}

export function createMutation(type: CrystalMutationType, sourceRef: string): CrystalMutation {
  return { type, source_ref: sourceRef, mutation_hash: computeMutationHash(type, sourceRef) }
}

export function computeCrystalHash(input: Pick<CrystalArtifactV0, "crystal_version" | "receipt_root" | "mutations">): string {
  const mutationHashes = [...input.mutations.map((mutation) => mutation.mutation_hash)].sort((a, b) => a.localeCompare(b))
  return `sha256:${sha256(canonicalize({
    crystal_version: input.crystal_version,
    receipt_root: input.receipt_root,
    mutation_hashes: mutationHashes,
  }))}`
}

export function createCrystalQrEnvelope(artifact: CrystalArtifactV0): CrystalQrEnvelopeV0 {
  return {
    crystal_version: artifact.crystal_version,
    receipt_root: artifact.receipt_root,
    mutation_hashes: [...artifact.mutations.map((mutation) => mutation.mutation_hash)].sort((a, b) => a.localeCompare(b)),
    crystal_hash: artifact.crystal_hash,
  }
}

export function verifyCrystalQrEnvelope(envelope: CrystalQrEnvelopeV0) {
  const recomputed = `sha256:${sha256(canonicalize({
    crystal_version: envelope.crystal_version,
    receipt_root: envelope.receipt_root,
    mutation_hashes: [...envelope.mutation_hashes].sort((a, b) => a.localeCompare(b)),
  }))}`
  return {
    ok: recomputed === envelope.crystal_hash,
    crystal_hash: envelope.crystal_hash,
    recomputed_crystal_hash: recomputed,
  }
}

export function buildCrystalArtifact(input: CrystalBuildInput): CrystalArtifactV0 {
  const stableId = input.chroniclePortfolio.portfolio_id
  const mutations = [
    createMutation("evidence_imported", stableId),
    createMutation("receipt_verified", stableId),
    createMutation("chronicle_entry_created", stableId),
    createMutation("portfolio_created", stableId),
    createMutation("portfolio_verified", stableId),
  ]

  const artifact: CrystalArtifactV0 = {
    crystal_version: "crystal_artifact.v0",
    receipt_root: input.portableProofObject.receipt_root,
    portfolio_root: input.chroniclePortfolio.portfolio_root,
    mutation_count: mutations.length,
    mutations,
    crystal_hash: "",
  }

  artifact.crystal_hash = computeCrystalHash(artifact)
  return artifact
}

export function verifyCrystalArtifact(artifact: CrystalArtifactV0) {
  const recomputed = computeCrystalHash(artifact)
  return {
    ok: recomputed === artifact.crystal_hash,
    crystal_hash: artifact.crystal_hash,
    recomputed_crystal_hash: recomputed,
  }
}

const CANONICAL_MUTATION_ORDER: CrystalMutationType[] = [
  "evidence_imported",
  "receipt_verified",
  "chronicle_entry_created",
  "portfolio_created",
  "portfolio_verified",
]

export function detectDefects(
  artifact: CrystalArtifactV0,
  inputs: Pick<CrystalBuildInput, "portableProofObject" | "chronicleEntry" | "chroniclePortfolio">,
): CrystalDefect[] {
  const defects: CrystalDefect[] = []
  const verification = verifyCrystalArtifact(artifact)
  if (!verification.ok) {
    defects.push({
      type: "hash_mismatch",
      detail: `stored ${artifact.crystal_hash} != recomputed ${verification.recomputed_crystal_hash}`,
    })
  }

  const activeMutations = artifact.mutations.slice(0, artifact.mutation_count)
  const activeTypes = activeMutations.map((mutation) => mutation.type)
  const expectedPrefix = CANONICAL_MUTATION_ORDER.slice(0, activeTypes.length)
  const orderedPrefix = activeTypes.every((type, index) => type === expectedPrefix[index])
  const uniqueTypes = new Set(activeTypes)

  if (artifact.mutation_count < CANONICAL_MUTATION_ORDER.length) {
    defects.push({
      type: "incomplete_history",
      detail: `chain stops at ${activeTypes.at(-1) ?? "none"} before portfolio_verified`,
    })
  }

  if (!orderedPrefix || uniqueTypes.size !== activeTypes.length) {
    defects.push({
      type: "broken_chain",
      detail: `observed sequence ${activeTypes.join(" -> ") || "(empty)"}`,
    })
  }

  const portableReceiptRoot = inputs.portableProofObject.receipt_root
  const rootRefs = [artifact.receipt_root, inputs.chronicleEntry.receipt_root]
  const contradictoryMutation = activeMutations.find((mutation) => mutation.source_ref.startsWith("0x") && mutation.source_ref !== portableReceiptRoot)
  if (rootRefs.some((root) => root !== portableReceiptRoot) || contradictoryMutation) {
    defects.push({
      type: "root_inconsistency",
      detail: contradictoryMutation
        ? `mutation source_ref ${contradictoryMutation.source_ref} != ${portableReceiptRoot}`
        : `artifact/entry receipt_root != ${portableReceiptRoot}`,
    })
  }

  return defects
}

function hashToUint32(seed: string, offset: number) {
  return Number.parseInt(seed.slice(offset, offset + 8), 16) >>> 0
}

function frac(seed: string, offset: number) {
  return hashToUint32(seed, offset) / 0xffffffff
}

function f(n: number) {
  return n.toFixed(4)
}

function hslToHex(h: number, s: number, l: number) {
  const hue = (((h % 360) + 360) % 360) / 360
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s
  const p = 2 * l - q
  const t = [hue + 1 / 3, hue, hue - 1 / 3].map((value) => {
    let v = value
    if (v < 0) v += 1
    if (v > 1) v -= 1
    if (v < 1 / 6) return p + (q - p) * 6 * v
    if (v < 1 / 2) return q
    if (v < 2 / 3) return p + (q - p) * (2 / 3 - v) * 6
    return p
  })
  return `#${t.map((channel) => Math.round(channel * 255).toString(16).padStart(2, "0")).join("")}`
}

function buildNotchedSquarePath(
  cx: number,
  cy: number,
  radius: number,
  rotation: number,
  notchSeed: string,
  seedOffset: number,
  options?: { ruptured?: boolean },
) {
  const baseAngles = [Math.PI / 4, 3 * Math.PI / 4, 5 * Math.PI / 4, 7 * Math.PI / 4].map((angle) => angle + rotation)
  const corners = baseAngles.map((angle) => ({ x: cx + Math.cos(angle) * radius, y: cy + Math.sin(angle) * radius }))
  const maxEdges = options?.ruptured ? 3 : 4
  const points: { x: number; y: number }[] = []

  for (let edge = 0; edge < maxEdges; edge += 1) {
    const a = corners[edge]!
    const b = corners[(edge + 1) % 4]!
    if (edge === 0) points.push(a)
    const n1 = 0.33
    const n2 = 0.66
    const depth1 = 0.05 + frac(notchSeed, seedOffset + edge * 11) * 0.06
    const depth2 = 0.05 + frac(notchSeed, seedOffset + edge * 13 + 5) * 0.06
    const mids = [
      { t: n1 - 0.06, depth: 0 },
      { t: n1, depth: depth1 },
      { t: n1 + 0.06, depth: 0 },
      { t: n2 - 0.06, depth: 0 },
      { t: n2, depth: depth2 },
      { t: n2 + 0.06, depth: 0 },
    ]
    for (const mid of mids) {
      const px = a.x + (b.x - a.x) * mid.t
      const py = a.y + (b.y - a.y) * mid.t
      const dx = cx - px
      const dy = cy - py
      points.push({ x: px + dx * mid.depth, y: py + dy * mid.depth })
    }
    points.push(b)
  }

  return `${points.map((point, index) => `${index === 0 ? "M" : "L"}${f(point.x)} ${f(point.y)}`).join(" ")}${options?.ruptured ? "" : " Z"}`
}

export async function renderQrSvg(payload: string) {
  const raw = await QRCode.toString(payload, {
    type: "svg",
    errorCorrectionLevel: "M",
    margin: 4,
    width: 420,
    color: { dark: "#111111", light: "#ffffff" },
  })

  return raw
    .replace(/<\?xml[^>]*>/g, "")
    .replace(/<!DOCTYPE[^>]*>/g, "")
    .replace(/\r?\n/g, "")
    .trim()
}

export async function renderCrystalArtifactSvg(artifact: CrystalArtifactV0, defects: CrystalDefect[] = [], qrPayload?: string, variant: "dark" | "light" = "dark") {
  const payload = qrPayload ?? canonicalize(createCrystalQrEnvelope(artifact))
  const qrSvg = await renderQrSvg(payload)
  const hash = artifact.crystal_hash.replace(/^sha256:/, "")
  const receiptSeed = artifact.receipt_root.replace(/^0x/, "")
  const width = 1000
  const height = 780
  const cx = 388
  const cy = 352
  const bg = variant === "dark" ? "#0d1117" : "#f5f7fa"
  const textColor = variant === "dark" ? "#e2e8f0" : "#0f172a"
  const mutedText = variant === "dark" ? "#94a3b8" : "#475569"
  const panelStroke = variant === "dark" ? "#334155" : "#cbd5e1"
  const defectTypes = new Set(defects.map((defect) => defect.type))
  const isBrokenChain = defectTypes.has("broken_chain")
  const isIncomplete = defectTypes.has("incomplete_history")
  const isHashMismatch = defectTypes.has("hash_mismatch")
  const isRootInconsistent = defectTypes.has("root_inconsistency")
  const baseHues = [46, 275, 145, 22, 215]

  const clusterData = artifact.mutations.map((mutation, ci) => {
    const clusterHash = mutation.mutation_hash.replace(/^sha256:/, "")
    const angle = ((Math.PI * 2 * ci) / artifact.mutations.length) + frac(hash, ci * 9) * 0.5 - 0.25
    const distance = 95 + frac(hash, ci * 11 + 3) * 55
    const size = 96 + frac(hash, ci * 7 + 5) * 60
    const rotation = ((hashToUint32(hash, ci * 6) % 90) * Math.PI) / 180
    const terraceCount = 5 + (hashToUint32(hash, ci * 8) % 2)
    const spiralStep = ((6 + Math.floor(frac(hash, ci * 5 + 2) * 8)) * Math.PI) / 180
    const x = cx + Math.cos(angle) * distance
    const y = cy + Math.sin(angle) * distance
    const hue = baseHues[ci % baseHues.length]! + Math.round(frac(hash, ci * 13 + 1) * 24 - 12)
    return { mutation, ci, clusterHash, angle, distance, size, rotation, terraceCount, spiralStep, x, y, hue }
  }).sort((a, b) => b.size - a.size)

  const clusterCentroid = clusterData.reduce((acc, cluster) => ({ x: acc.x + cluster.x, y: acc.y + cluster.y }), { x: 0, y: 0 })
  const centroidX = clusterCentroid.x / clusterData.length
  const centroidY = clusterCentroid.y / clusterData.length
  const coreOffsetAmount = 25 + Math.round(frac(hash, 14) * 5)
  const coreOffsetX = isRootInconsistent ? coreOffsetAmount : 0
  const coreOffsetY = isRootInconsistent ? -coreOffsetAmount : 0

  const activeCount = artifact.mutation_count
  const renderedClusters = clusterData.filter((cluster) => {
    if (isIncomplete) {
      return cluster.mutation.type !== "portfolio_verified"
    }
    return true
  }).map((cluster) => {
    const originalIndex = artifact.mutations.findIndex((m) => m.mutation_hash === cluster.mutation.mutation_hash)
    const affectsOuter = originalIndex === Math.max(activeCount - 1, 0) || (isBrokenChain && cluster.mutation.type === "portfolio_verified")
    const terraces: string[] = []
    for (let t = 0; t < cluster.terraceCount; t += 1) {
      const radius = cluster.size * (1 - t * 0.155)
      const rotation = cluster.rotation + t * cluster.spiralStep
      const fillL = 0.26 + t * 0.095
      const fill = hslToHex(cluster.hue + t * 7, 0.72, fillL)
      const strokeL = fillL + (variant === "dark" ? 0.38 : 0.18)
      const stroke = hslToHex(cluster.hue + 48, 0.95, Math.min(strokeL, variant === "dark" ? 0.92 : 0.48))
      const terrace = buildNotchedSquarePath(cluster.x, cluster.y, radius, rotation, hash, cluster.ci * 31 + t * 17, {
        ruptured: (isBrokenChain && affectsOuter && t === 0) || (isIncomplete && cluster.mutation.type === "portfolio_created" && t === 0),
      })
      const echo = buildNotchedSquarePath(cluster.x, cluster.y, Math.max(radius - 16, 8), rotation, hash, cluster.ci * 37 + t * 19)
      terraces.push(`<path d="${terrace}" fill="${fill}" fill-opacity="0.9" stroke="${stroke}" stroke-width="2.2000" />`)
      terraces.push(`<path d="${echo}" fill="none" stroke="${bg}" stroke-width="1.4000" opacity="0.88" />`)
    }
    return `<g id="cluster-${cluster.ci}">${terraces.join("")}</g>`
  }).join("")

  const calloutBase = clusterData.slice().sort((a, b) => a.y - b.y)
  const leftClusters = calloutBase.filter((cluster) => cluster.x < cx)
  const rightClusters = calloutBase.filter((cluster) => cluster.x >= cx)
  const renderCallouts = (clusters: typeof clusterData, side: "left" | "right") => clusters.map((cluster, index) => {
    const boxX = side === "left" ? 16 : width - 232
    const boxY = 84 + index * 58
    const boxW = 216
    const boxH = 34
    const targetX = side === "left" ? boxX + boxW : boxX
    const lineStartX = cluster.x + Math.cos(cluster.angle) * (cluster.size * 0.58)
    const lineStartY = cluster.y + Math.sin(cluster.angle) * (cluster.size * 0.52)
    return [
      `<path d="M${f(lineStartX)} ${f(lineStartY)} L${f((lineStartX + targetX) / 2)} ${f(boxY + boxH / 2)} L${f(targetX)} ${f(boxY + boxH / 2)}" fill="none" stroke="${textColor}" stroke-width="1.6000" opacity="0.45" />`,
      `<rect x="${f(boxX)}" y="${f(boxY)}" width="${f(boxW)}" height="${f(boxH)}" rx="12.0000" fill="${variant === "dark" ? "#111827" : "#ffffff"}" stroke="${panelStroke}" stroke-width="1.4000" />`,
      `<text x="${f(boxX + 12)}" y="${f(boxY + 22)}" font-family="monospace" font-size="13.5000" fill="${textColor}">${cluster.ci + 1}. ${cluster.mutation.type}</text>`,
    ].join("")
  }).join("")

  const crack = isHashMismatch
    ? `<g id="fracture" stroke="${variant === "dark" ? "#f8fafc" : "#111111"}" stroke-width="6.0000" fill="none" opacity="0.92"><path d="M120.0000 130.0000 L240.0000 220.0000 L300.0000 330.0000 L430.0000 410.0000 L520.0000 520.0000 L690.0000 620.0000" /><path d="M158.0000 142.0000 L262.0000 255.0000 L336.0000 344.0000 L462.0000 438.0000 L556.0000 548.0000 L722.0000 640.0000" /></g>`
    : ""

  const qrViewBoxMatch = qrSvg.match(/viewBox="([^"]+)"/)
  const qrViewBox = qrViewBoxMatch ? qrViewBoxMatch[1]! : "0 0 420 420"
  const qrInner = qrSvg.replace(/<svg[^>]*>|<\/svg>/g, "")
  const qrPanelX = 720
  const qrPanelY = 420
  const qrPanelSize = 240
  const qrInset = 18
  const qrRenderSize = qrPanelSize - qrInset * 2

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
    `<rect x="0" y="0" width="${width}" height="${height}" fill="${bg}" />`,
    `<g id="clusters">${renderedClusters}</g>`,
    `${crack}`,
    `<g id="capsule-core">`,
    `<defs><radialGradient id="capsule-grad" cx="35%" cy="28%" r="75%"><stop offset="0%" stop-color="#ffffff" stop-opacity="0.98" /><stop offset="55%" stop-color="#bfd3e6" stop-opacity="0.95" /><stop offset="100%" stop-color="#6b7f96" stop-opacity="0.98" /></radialGradient></defs>`,
    `<circle cx="${f(centroidX + coreOffsetX)}" cy="${f(centroidY + coreOffsetY)}" r="${f(60 + (hashToUint32(receiptSeed, 0) % 12))}" fill="url(#capsule-grad)" stroke="${variant === "dark" ? "#e2e8f0" : "#334155"}" stroke-width="2.0000" />`,
    `<circle cx="${f(centroidX + coreOffsetX)}" cy="${f(centroidY + coreOffsetY)}" r="${f(46 + (hashToUint32(receiptSeed, 0) % 12))}" fill="none" stroke="${variant === "dark" ? "#f8fafc" : "#0f172a"}" stroke-width="1.4000" stroke-dasharray="5 5" opacity="0.7" />`,
    `<ellipse cx="${f(centroidX - 18 + coreOffsetX)}" cy="${f(centroidY - 20 + coreOffsetY)}" rx="16.0000" ry="10.0000" fill="#ffffff" fill-opacity="0.52" />`,
    `<text x="${f(centroidX + coreOffsetX)}" y="${f(centroidY - 2 + coreOffsetY)}" text-anchor="middle" font-family="monospace" font-size="16.0000" fill="${variant === "dark" ? "#0f172a" : "#0f172a"}">evidence</text>`,
    `<text x="${f(centroidX + coreOffsetX)}" y="${f(centroidY + 18 + coreOffsetY)}" text-anchor="middle" font-family="monospace" font-size="14.0000" fill="${variant === "dark" ? "#0f172a" : "#0f172a"}">capsule</text>`,
    `</g>`,
    `<g id="title" font-family="monospace" fill="${textColor}">`,
    `<text x="26.0000" y="34.0000" font-size="22.0000">Crystal Artifact v0</text>`,
    `<text x="26.0000" y="58.0000" font-size="13.0000">mutation_count: ${artifact.mutation_count}</text>`,
    `<text x="26.0000" y="78.0000" font-size="13.0000">crystal_hash: ${artifact.crystal_hash}</text>`,
    `</g>`,
    `<g id="callouts">${renderCallouts(leftClusters, "left")}${renderCallouts(rightClusters, "right")}</g>`,
    `<g id="qr-panel">`,
    `<rect x="${f(qrPanelX)}" y="${f(qrPanelY)}" width="${f(qrPanelSize)}" height="${f(qrPanelSize)}" rx="20.0000" fill="#ffffff" stroke="${panelStroke}" stroke-width="2.0000" />`,
    `<svg id="qr" x="${f(qrPanelX + qrInset)}" y="${f(qrPanelY + qrInset)}" width="${f(qrRenderSize)}" height="${f(qrRenderSize)}" viewBox="${qrViewBox}">${qrInner}</svg>`,
    `</g>`,
    `<text x="${f(qrPanelX + qrPanelSize / 2)}" y="${f(qrPanelY - 14)}" text-anchor="middle" font-family="monospace" font-size="15.0000" fill="${textColor}">Scan for offline verification</text>`,
    `<text x="${f(qrPanelX + qrPanelSize / 2)}" y="${f(qrPanelY + qrPanelSize + 24)}" text-anchor="middle" font-family="monospace" font-size="12.5000" fill="${mutedText}">Tier-1 envelope only</text>`,
    `</svg>`,
  ].join("")
}

export async function decodeQrPayloadFromArtifactSvg(svg: string) {
  const resvg = new Resvg(svg)
  const pngData = resvg.render()
  const png = PNG.sync.read(pngData.asPng())
  const result = jsQR(new Uint8ClampedArray(png.data.buffer), png.width, png.height)
  if (!result) {
    throw new Error("QR decode failed")
  }
  return result.data
}

export async function renderSvgScreenshot(svg: string, outPath: string) {
  mkdirSync(dirname(outPath), { recursive: true })
  const resvg = new Resvg(svg)
  writeFileSync(outPath, resvg.render().asPng())
}

export function readJsonFile<T>(path: string): T {
  return JSON.parse(readFileSync(resolve(path), "utf8")) as T
}

export async function buildCrystalArtifactFromFiles(paths: {
  portableProofObject: string
  chronicleEntry: string
  chroniclePortfolio: string
}): Promise<CrystalBuildResult> {
  const portableProofObject = readJsonFile<PortableProofObjectV0>(paths.portableProofObject)
  const chronicleEntry = readJsonFile<ChronicleEntryV0>(paths.chronicleEntry)
  const chroniclePortfolio = readJsonFile<ChroniclePortfolioV0>(paths.chroniclePortfolio)
  const artifact = buildCrystalArtifact({ portableProofObject, chronicleEntry, chroniclePortfolio })
  const defects = detectDefects(artifact, { portableProofObject, chronicleEntry, chroniclePortfolio })
  const qrEnvelope = createCrystalQrEnvelope(artifact)
  const qrPayload = canonicalize(qrEnvelope)
  const svg = await renderCrystalArtifactSvg(artifact, defects, qrPayload)
  return { artifact, defects, svg, qrPayload, qrEnvelope }
}
