import { mkdirSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"
import { buildCrystalArtifactFromFiles, decodeQrPayloadFromArtifactSvg, renderSvgScreenshot, verifyCrystalArtifact } from "../src/crystal-artifact"

const outDir = resolve("examples/output")
mkdirSync(outDir, { recursive: true })

const built = await buildCrystalArtifactFromFiles({
  portableProofObject: "examples/inputs/portable-proof-object-v0.json",
  chronicleEntry: "examples/inputs/chronicle-entry-v0.json",
  chroniclePortfolio: "examples/inputs/chronicle-portfolio-v0.json",
})

writeFileSync(resolve(outDir, "crystal_artifact.v0.json"), JSON.stringify(built.artifact, null, 2) + "\n")
writeFileSync(resolve(outDir, "crystal_artifact.svg"), built.svg)
await renderSvgScreenshot(built.svg, resolve(outDir, "crystal_artifact.png"))
const qrPayload = await decodeQrPayloadFromArtifactSvg(built.svg)
const verification = verifyCrystalArtifact(JSON.parse(qrPayload))
writeFileSync(resolve(outDir, "qr-roundtrip.json"), JSON.stringify({ qrPayload, verification }, null, 2) + "\n")
console.log(JSON.stringify({
  crystal_hash: built.artifact.crystal_hash,
  qr_roundtrip_ok: verification.ok,
  output_dir: outDir,
}, null, 2))
