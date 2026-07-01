import { describe, expect, test } from "bun:test"
import { canonicalize } from "../src/canon"
import {
  buildCrystalArtifactFromFiles,
  computeCrystalHash,
  decodeQrPayloadFromArtifactSvg,
  renderCrystalArtifactSvg,
  verifyCrystalArtifact,
} from "../src/crystal-artifact"
import type { CrystalArtifactV0 } from "../src/types"

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
  })

  test("qr round-trip recomputes crystal_hash", async () => {
    const built = await buildCrystalArtifactFromFiles(inputPaths)
    const payload = await decodeQrPayloadFromArtifactSvg(built.svg)
    const parsed = JSON.parse(payload) as CrystalArtifactV0
    const verification = verifyCrystalArtifact(parsed)
    expect(verification.ok).toBe(true)
    expect(verification.recomputed_crystal_hash).toBe(parsed.crystal_hash)
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
    const svgAgain = await renderCrystalArtifactSvg(built.artifact)
    expect(svgAgain).toBe(built.svg)
  })

  test("crystal artifact compact payload is canonical JSON", async () => {
    const built = await buildCrystalArtifactFromFiles(inputPaths)
    expect(built.qrPayload).toBe(canonicalize(built.artifact))
  })
})
