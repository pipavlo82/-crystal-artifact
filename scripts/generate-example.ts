import { mkdirSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"
import { Resvg } from "@resvg/resvg-js"
import { canonicalize } from "../src/canon"
import { buildCrystalArtifactFromFiles, decodeQrPayloadFromArtifactSvg, renderQrSvg, renderSvgScreenshot, verifyCrystalQrEnvelope } from "../src/crystal-artifact"

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
const verification = verifyCrystalQrEnvelope(JSON.parse(qrPayload))
writeFileSync(resolve(outDir, "qr-roundtrip.json"), JSON.stringify({ qrPayload, qrEnvelope: built.qrEnvelope, verification }, null, 2) + "\n")

const fullArtifactQrSvg = await renderQrSvg(canonicalize(built.artifact))
const envelopeQrSvg = await renderQrSvg(built.qrPayload)
const comparisonSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="520" viewBox="0 0 900 520"><rect width="900" height="520" fill="#ffffff" /><text x="60" y="50" font-family="monospace" font-size="24">Before: full artifact QR</text><text x="500" y="50" font-family="monospace" font-size="24">After: Tier-1 envelope QR</text><g transform="translate(60,80)">${fullArtifactQrSvg.replace(/<svg[^>]*>|<\/svg>/g, "")}</g><g transform="translate(500,80)">${envelopeQrSvg.replace(/<svg[^>]*>|<\/svg>/g, "")}</g><text x="60" y="460" font-family="monospace" font-size="18">payload chars: ${canonicalize(built.artifact).length}</text><text x="500" y="460" font-family="monospace" font-size="18">payload chars: ${built.qrPayload.length}</text></svg>`
writeFileSync(resolve(outDir, "qr-density-comparison.svg"), comparisonSvg)
const comparisonPng = new Resvg(comparisonSvg).render().asPng()
writeFileSync(resolve(outDir, "qr-density-comparison.png"), comparisonPng)
writeFileSync(resolve(outDir, "qr-density-comparison.json"), JSON.stringify({ before_chars: canonicalize(built.artifact).length, after_chars: built.qrPayload.length }, null, 2) + "\n")

console.log(JSON.stringify({
  crystal_hash: built.artifact.crystal_hash,
  qr_roundtrip_ok: verification.ok,
  output_dir: outDir,
}, null, 2))
