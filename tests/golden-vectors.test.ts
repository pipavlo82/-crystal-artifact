import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { canonicalize, sha256 } from "../src/canon"

type Vector = { name: string; input: Record<string, unknown>; expected_root: string }
type Fixture = { artifact: Vector[]; collection: Vector[]; portfolio: Vector[] }
const fixture = JSON.parse(readFileSync(resolve(import.meta.dir, "./fixtures/chronicle-root-golden-vectors.json"), "utf8")) as Fixture

function root(input: Record<string, unknown>) {
  return `sha256:${sha256(canonicalize(input))}`
}

describe("golden vectors match copied canonicalize", () => {
  for (const vector of fixture.artifact) {
    test(`artifact ${vector.name}`, () => expect(root({
      artifact_version: vector.input.artifact_version,
      artifact_scope: vector.input.artifact_scope,
      position_id: vector.input.position_id,
      entry_refs: [...(vector.input.entry_refs as string[])].sort((a, b) => a.localeCompare(b)),
      receipt_refs: [...(vector.input.receipt_refs as string[])].sort((a, b) => a.localeCompare(b)),
    })).toBe(vector.expected_root))
  }
  for (const vector of fixture.collection) {
    test(`collection ${vector.name}`, () => expect(root({
      collection_version: vector.input.collection_version,
      collection_id: vector.input.collection_id,
      artifact_refs: [...(vector.input.artifact_refs as string[])].sort((a, b) => a.localeCompare(b)),
    })).toBe(vector.expected_root))
  }
  for (const vector of fixture.portfolio) {
    test(`portfolio ${vector.name}`, () => expect(root({
      portfolio_version: vector.input.portfolio_version,
      portfolio_id: vector.input.portfolio_id,
      collection_refs: [...(vector.input.collection_refs as string[])].sort((a, b) => a.localeCompare(b)),
    })).toBe(vector.expected_root))
  }
})
