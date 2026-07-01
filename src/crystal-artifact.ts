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

function f(n: number) {
  return n.toFixed(4)
}

function layerPath(cx: number, cy: number, baseRadius: number, hash: string, layerIndex: number, options?: { ruptured?: boolean }) {
  const sideSeed = hashToUint32(hash, (layerIndex * 8) % (hash.length - 8))
  const sides = 6 + (sideSeed % 5)
  const rotation = (hashToUint32(hash, (layerIndex * 10 + 4) % (hash.length - 8)) / 0xffffffff) * Math.PI * 2
  const jitter = (hashToUint32(hash, (layerIndex * 12 + 6) % (hash.length - 8)) / 0xffffffff) * 0.12 + 0.88
  const radius = baseRadius + layerIndex * 18
  const points: string[] = []

  const maxPoints = options?.ruptured ? sides - 1 : sides
  for (let i = 0; i < maxPoints; i += 1) {
    const angle = rotation + (Math.PI * 2 * i) / sides
    const radialBias = 0.82 + (((hashToUint32(hash, (i * 4 + layerIndex * 3) % (hash.length - 8)) / 0xffffffff) * 0.34) * jitter)
    const x = cx + Math.cos(angle) * radius * radialBias
    const y = cy + Math.sin(angle) * radius * (0.7 + radialBias * 0.25)
    points.push(`${i === 0 ? "M" : "L"}${f(x)} ${f(y)}`)
  }

  return options?.ruptured ? points.join(" ") : `${points.join(" ")} Z`
}

export async function renderQrSvg(payload: string) {
  const raw = await QRCode.toString(payload, {
    type: "svg",
    errorCorrectionLevel: "H",
    margin: 0,
    width: 220,
    color: { dark: "#111111", light: "#ffffff" },
  })

  return raw
    .replace(/<\?xml[^>]*>/g, "")
    .replace(/<!DOCTYPE[^>]*>/g, "")
    .replace(/\r?\n/g, "")
    .trim()
}

export async function renderCrystalArtifactSvg(artifact: CrystalArtifactV0, defects: CrystalDefect[] = [], qrPayload?: string) {
  const payload = qrPayload ?? canonicalize(createCrystalQrEnvelope(artifact))
  const qrSvg = await renderQrSvg(payload)
  const hash = artifact.crystal_hash.replace(/^sha256:/, "")
  const receiptSeed = artifact.receipt_root.replace(/^0x/, "")
  const width = 1200
  const height = 1600
  const cx = 420
  const cy = 620
  const defectTypes = new Set(defects.map((defect) => defect.type))
  const isBrokenChain = defectTypes.has("broken_chain")
  const isIncomplete = defectTypes.has("incomplete_history")
  const isHashMismatch = defectTypes.has("hash_mismatch")
  const isRootInconsistent = defectTypes.has("root_inconsistency")
  const baseRadius = 120 + (hashToUint32(receiptSeed, 0) % 40)
  const layers = artifact.mutations.map((mutation, index) => {
    const isOuterAffected = index >= Math.max(artifact.mutation_count - 1, 0)
    const d = layerPath(cx, cy, baseRadius, mutation.mutation_hash.replace(/^sha256:/, ""), index, {
      ruptured: (isBrokenChain || isIncomplete) && isOuterAffected,
    })
    const hue = (hashToUint32(mutation.mutation_hash.replace(/^sha256:/, ""), 0) % 360)
    const opacity = 0.18 + index * 0.11
    const fill = isBrokenChain || isIncomplete ? `hsla(0,0%,${f(55 + index * 5)},${f(Math.min(opacity, 0.82))})` : `hsla(${hue},70%,65%,${f(Math.min(opacity, 0.82))})`
    return `<path d="${d}" fill="${fill}" stroke="#0f172a" stroke-width="2.0000" />`
  }).join("")
  const coreOffsetX = isRootInconsistent ? 42 : 0
  const coreOffsetY = isRootInconsistent ? -28 : 0
  const crack = isHashMismatch
    ? `<g id="fracture" stroke="#111111" stroke-width="6.0000" fill="none"><path d="M180.0000 360.0000 L320.0000 520.0000 L250.0000 700.0000 L410.0000 860.0000 L360.0000 1030.0000" /><path d="M215.0000 350.0000 L345.0000 500.0000 L285.0000 690.0000 L438.0000 845.0000 L398.0000 1012.0000" /></g>`
    : ""

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
    `<rect x="0" y="0" width="${width}" height="${height}" fill="#f8fafc" />`,
    `<g id="crystal-layers">${layers}</g>`,
    `${crack}`,
    `<g id="receipt-seed"><circle cx="${f(cx + coreOffsetX)}" cy="${f(cy + coreOffsetY)}" r="${f(baseRadius * 0.42)}" fill="#e2e8f0" stroke="#0f172a" stroke-width="2.0000" /></g>`,
    `<g id="labels" font-family="monospace" fill="#0f172a">`,
    `<text x="80.0000" y="116.0000" font-size="34.0000">Crystal Artifact v0</text>`,
    `<text x="80.0000" y="154.0000" font-size="18.0000">mutation_count: ${artifact.mutation_count}</text>`,
    `<text x="80.0000" y="186.0000" font-size="18.0000">receipt_root: ${artifact.receipt_root}</text>`,
    `<text x="80.0000" y="218.0000" font-size="18.0000">portfolio_root: ${artifact.portfolio_root}</text>`,
    `<text x="80.0000" y="250.0000" font-size="18.0000">crystal_hash: ${artifact.crystal_hash}</text>`,
    `</g>`,
    `<g id="mutation-legend" font-family="monospace" fill="#0f172a">${artifact.mutations.map((mutation, index) => `<text x="80.0000" y="${f(1030 + index * 36)}" font-size="16.0000">${index + 1}. ${mutation.type} → ${mutation.source_ref}</text>`).join("")}</g>`,
    `<g id="qr" transform="translate(830,1180)">${qrSvg.replace(/<svg[^>]*>|<\/svg>/g, "")}</g>`,
    `<text x="830.0000" y="1160.0000" font-family="monospace" font-size="18.0000" fill="#0f172a">scan to verify offline</text>`,
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
