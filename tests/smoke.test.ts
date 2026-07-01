import { describe, expect, test } from "bun:test"
import { canonicalize } from "../src/canon"
import {
  buildCrystalArtifactFromFiles,
  computeCrystalHash,
  createCrystalQrEnvelope,
  decodeQrPayloadFromArtifactSvg,
  detectDefects,
  renderCrystalArtifactSvg,
  verifyCrystalArtifact,
  verifyCrystalQrEnvelope,
} from "../src/crystal-artifact"
import type { CrystalArtifactV0, CrystalQrEnvelopeV0 } from "../src/types"

const inputPaths = {
  portableProofObject: "examples/inputs/portable-proof-object-v0.json",
  chronicleEntry: "examples/inputs/chronicle-entry-v0.json",
  chroniclePortfolio: "examples/inputs/chronicle-portfolio-v0.json",
}

describe("crystal artifact smoke", () => {
  test("generate twice -> identical crystal_hash, qr payload, svg bytes", async () => {
    const first = await buildCrystalArtifactFromFiles(inputPaths)
    const second = await buildCrystalArtifactFromFiles(inputPaths)
    expect(first.artifact.crystal_hash).toBe(second.artifact.crystal_hash)
    expect(first.qrPayload).toBe(second.qrPayload)
    expect(first.svg).toBe(second.svg)
    expect(first.defects).toEqual([])
  })

  test("qr round-trip recomputes crystal_hash from minimal envelope", async () => {
    const built = await buildCrystalArtifactFromFiles(inputPaths)
    const payload = await decodeQrPayloadFromArtifactSvg(built.svg)
    const parsed = JSON.parse(payload) as CrystalQrEnvelopeV0
    const verification = verifyCrystalQrEnvelope(parsed)
    expect(verification.ok).toBe(true)
    expect(verification.recomputed_crystal_hash).toBe(parsed.crystal_hash)
    expect(parsed.crystal_hash).toBe("sha256:74350a81c792a943aa75e577b3ea721aa98af01f488780f7c7f77b0149d36f6f")
    expect(parsed).toEqual(createCrystalQrEnvelope(built.artifact))
  })

  test("guard: fake svg / timestamp / color do not affect crystal_hash", async () => {
    const built = await buildCrystalArtifactFromFiles(inputPaths)
    const mutated: CrystalArtifactV0 = {
      ...built.artifact,
      svg: "<svg>fake</svg>",
      rendered_at: new Date().toISOString(),
      color: "iridescent-rainbow",
    }
    expect(computeCrystalHash(mutated)).toBe(built.artifact.crystal_hash)
  })

  test("svg renderer is deterministic from artifact fields", async () => {
    const built = await buildCrystalArtifactFromFiles(inputPaths)
    const svgAgain = await renderCrystalArtifactSvg(built.artifact, built.defects)
    expect(svgAgain).toBe(built.svg)
  })

  test("crystal qr payload is canonical minimal envelope", async () => {
    const built = await buildCrystalArtifactFromFiles(inputPaths)
    expect(built.qrPayload).toBe(canonicalize(built.qrEnvelope))
    expect(Object.keys(built.qrEnvelope).sort()).toEqual(["crystal_hash", "crystal_version", "mutation_hashes", "receipt_root"])
  })

  test("detects hash_mismatch and crystal_hash recomputes unchanged", async () => {
    const built = await buildCrystalArtifactFromFiles(inputPaths)
    const broken = { ...built.artifact, crystal_hash: `sha256:${"0".repeat(64)}` }
    const defects = detectDefects(broken, {
      portableProofObject: JSON.parse(await Bun.file(inputPaths.portableProofObject).text()),
      chronicleEntry: JSON.parse(await Bun.file(inputPaths.chronicleEntry).text()),
      chroniclePortfolio: JSON.parse(await Bun.file(inputPaths.chroniclePortfolio).text()),
    })
    expect(defects.some((d) => d.type === "hash_mismatch")).toBe(true)
    expect(computeCrystalHash(built.artifact)).toBe(computeCrystalHash(broken))
  })

  test("detects broken_chain and crystal_hash is order-invariant", async () => {
    const built = await buildCrystalArtifactFromFiles(inputPaths)
    const broken = { ...built.artifact, mutations: [built.artifact.mutations[0]!, built.artifact.mutations[2]!, built.artifact.mutations[1]!, built.artifact.mutations[3]!, built.artifact.mutations[4]!] }
    const defects = detectDefects(broken, {
      portableProofObject: JSON.parse(await Bun.file(inputPaths.portableProofObject).text()),
      chronicleEntry: JSON.parse(await Bun.file(inputPaths.chronicleEntry).text()),
      chroniclePortfolio: JSON.parse(await Bun.file(inputPaths.chroniclePortfolio).text()),
    })
    expect(defects.some((d) => d.type === "broken_chain")).toBe(true)
    expect(computeCrystalHash(built.artifact)).toBe(computeCrystalHash(broken))
  })

  test("detects root_inconsistency and crystal_hash is unaffected by input contradiction", async () => {
    const built = await buildCrystalArtifactFromFiles(inputPaths)
    const portableProofObject = JSON.parse(await Bun.file(inputPaths.portableProofObject).text())
    const chronicleEntry = { ...(JSON.parse(await Bun.file(inputPaths.chronicleEntry).text())), receipt_root: `0x${"f".repeat(64)}` }
    const chroniclePortfolio = JSON.parse(await Bun.file(inputPaths.chroniclePortfolio).text())
    const defects = detectDefects(built.artifact, { portableProofObject, chronicleEntry, chroniclePortfolio })
    expect(defects.some((d) => d.type === "root_inconsistency")).toBe(true)
    expect(computeCrystalHash(built.artifact)).toBe(built.artifact.crystal_hash)
  })

  test("detects incomplete_history and crystal_hash is unchanged when only mutation_count is shortened", async () => {
    const built = await buildCrystalArtifactFromFiles(inputPaths)
    const broken = { ...built.artifact, mutation_count: 4 }
    const defects = detectDefects(broken, {
      portableProofObject: JSON.parse(await Bun.file(inputPaths.portableProofObject).text()),
      chronicleEntry: JSON.parse(await Bun.file(inputPaths.chronicleEntry).text()),
      chroniclePortfolio: JSON.parse(await Bun.file(inputPaths.chroniclePortfolio).text()),
    })
    expect(defects.some((d) => d.type === "incomplete_history")).toBe(true)
    expect(computeCrystalHash(built.artifact)).toBe(computeCrystalHash(broken))
  })
})
