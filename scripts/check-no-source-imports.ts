import { readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"

const roots = ["src", "tests", "scripts", "examples"]
const banned = [/from .*crystal-receipt/i, /from .*ReceiptOS/i, /\.\.\/crystal-receipt/i, /C:\\Users\\msi\\dev\\crystal-receipt\\src/i]
const hits: string[] = []
const selfPath = join("scripts", "check-no-source-imports.ts")

function walk(dir: string) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    const stat = statSync(full)
    if (stat.isDirectory()) {
      walk(full)
      continue
    }
    if (full.endsWith(selfPath)) continue
    const text = readFileSync(full, "utf8")
    const lines = text.split(/\r?\n/)
    for (let i = 0; i < lines.length; i += 1) {
      if (banned.some((pattern) => pattern.test(lines[i]!))) {
        hits.push(`${full}:${i + 1}: ${lines[i]}`)
      }
    }
  }
}

for (const root of roots) walk(root)
if (hits.length > 0) {
  console.error(hits.join("\n"))
  process.exit(1)
}
console.log("OK")
