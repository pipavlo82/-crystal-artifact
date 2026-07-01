import { mkdirSync, writeFileSync, cpSync } from "node:fs"
import { resolve } from "node:path"
import { buildCrystalArtifactFromFiles, detectDefects, renderCrystalArtifactSvg, renderSvgScreenshot, verifyCrystalArtifact } from "../src/crystal-artifact"
import type { ChronicleEntryV0, CrystalArtifactV0, CrystalBuildInput, PortableProofObjectV0, ChroniclePortfolioV0 } from "../src/types"

const basePaths = {
  portableProofObject: resolve("examples/inputs/portable-proof-object-v0.json"),
  chronicleEntry: resolve("examples/inputs/chronicle-entry-v0.json"),
  chroniclePortfolio: resolve("examples/inputs/chronicle-portfolio-v0.json"),
}

const clean = await buildCrystalArtifactFromFiles(basePaths)
const cleanOutDir = resolve("examples/output")
mkdirSync(cleanOutDir, { recursive: true })

const portableProofObject = JSON.parse(await Bun.file(basePaths.portableProofObject).text()) as PortableProofObjectV0
const chronicleEntry = JSON.parse(await Bun.file(basePaths.chronicleEntry).text()) as ChronicleEntryV0
const chroniclePortfolio = JSON.parse(await Bun.file(basePaths.chroniclePortfolio).text()) as ChroniclePortfolioV0

const scenarios: Record<string, { artifact: CrystalArtifactV0; inputs: CrystalBuildInput }> = {
  hash_mismatch: {
    artifact: { ...clean.artifact, crystal_hash: `sha256:${"0".repeat(64)}` },
    inputs: { portableProofObject, chronicleEntry, chroniclePortfolio },
  },
  broken_chain: {
    artifact: { ...clean.artifact, mutations: [clean.artifact.mutations[0]!, clean.artifact.mutations[2]!, clean.artifact.mutations[1]!, clean.artifact.mutations[3]!, clean.artifact.mutations[4]!] },
    inputs: { portableProofObject, chronicleEntry, chroniclePortfolio },
  },
  root_inconsistency: {
    artifact: clean.artifact,
    inputs: { portableProofObject, chronicleEntry: { ...chronicleEntry, receipt_root: `0x${"f".repeat(64)}` }, chroniclePortfolio },
  },
  incomplete_history: {
    artifact: { ...clean.artifact, mutation_count: 4 },
    inputs: { portableProofObject, chronicleEntry, chroniclePortfolio },
  },
}

for (const [name, scenario] of Object.entries(scenarios)) {
  const outDir = resolve("examples/broken", name)
  mkdirSync(outDir, { recursive: true })
  const defects = detectDefects(scenario.artifact, scenario.inputs)
  const darkSvg = await renderCrystalArtifactSvg(scenario.artifact, defects, undefined, "dark")
  await renderSvgScreenshot(darkSvg, resolve(outDir, "crystal_artifact.png"))
  writeFileSync(resolve(outDir, "crystal_artifact.v0.json"), JSON.stringify(scenario.artifact, null, 2) + "\n")
  writeFileSync(resolve(outDir, "defects.json"), JSON.stringify({ defects, verification: verifyCrystalArtifact(scenario.artifact) }, null, 2) + "\n")
  writeFileSync(resolve(outDir, "input.json"), JSON.stringify(scenario.inputs, null, 2) + "\n")
}

cpSync(resolve("examples/output/crystal_artifact.png"), resolve("examples/broken/clean-reference.png"), { force: true })
console.log("broken examples generated")
