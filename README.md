# crystal-artifact

Crystal Artifact is a deterministic bismuth-style visual artifact that encodes a ReceiptOS → Chronicle proof history. Each mutation becomes one growth layer around the evidence capsule. It is designed to be printable on paper and verifiable back by scanning. The crystal proves nothing by itself; it is a portable, recomputable carrier that points at proofs verified elsewhere. It is not an asset, not a credential, and not a reputation score.

## Example

![Crystal Artifact example](examples/output/crystal_artifact.png)

5 mutations = 5 layers; the QR carries the artifact for offline verification.

## The chain it encodes

The current example follows this chain:

`Stealth evidence → ReceiptOS proof → portable_proof_object.v0 → chronicle_entry.v0 → chronicle_portfolio.v0`

The artifact records that history through five mutation types:

- `evidence_imported`
- `receipt_verified`
- `chronicle_entry_created`
- `portfolio_created`
- `portfolio_verified`

## How the hash works

The core invariant is the `crystal_hash`:

```text
crystal_hash = sha256(canonicalize({
  crystal_version,
  receipt_root,
  sorted mutation_hashes
}))
```

This hash deliberately excludes the SVG, timestamps, color, and visual parameters. The picture is derived from the history, but the picture does not define the history. That means the same proof history always yields the same `crystal_hash`, and a scanned copy can be recomputed and checked with zero trust. The guard test enforces this by injecting fake SVG, timestamp, and color fields and asserting that the `crystal_hash` stays byte-identical.

## Two-tier verification

Tier 1 is paper alone, offline: scan the QR, parse the artifact JSON, recompute `crystal_hash`, and check that it matches the embedded value.

Tier 2 uses the surrounding proof chain: check `receipt_root` and mutation `source_ref` values against real ReceiptOS and Chronicle outputs.

## Relationship to the ecosystem

This repository is an isolated experiment. It does not import `crystal-receipt` source and is not part of the ReceiptOS or Chronicle proof path; those systems remain the source of truth. The crystal is a secondary, optional visual representation. Its `canonicalize` function is a verified copy, locked to `crystal-receipt` by the golden-vector test so it cannot silently drift.

## Run it

```bash
bun install
bun test
bun run scripts/generate-example.ts
```
