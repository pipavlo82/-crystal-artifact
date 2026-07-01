export type PortableProofObjectV0 = {
  schema: "receiptos.portable_proof_object.v0"
  proof_object_id: string
  proof_system: string
  receipt_root: string
  proof_ref: string
  replay_ref: string | null
  anchor_ref: string | null
  source_evidence_ref?: string | null
  [key: string]: unknown
}

export type ChronicleEntryV0 = {
  schema: "chronicle_entry.v0"
  entry_id: string
  source_system: string
  receipt_root: string
  proof_object_ref: string
  evidence_capsule_ref: string
  provenance_summary_ref: string
  created_from: string | null
  labels: string[]
  notes: string | null
  [key: string]: unknown
}

export type ChroniclePortfolioV0 = {
  schema: "chronicle_portfolio.v0"
  portfolio_version: "chronicle_portfolio.v0"
  portfolio_id: string
  collection_refs: string[]
  portfolio_root: string
  [key: string]: unknown
}

export type CrystalMutationType =
  | "evidence_imported"
  | "receipt_verified"
  | "chronicle_entry_created"
  | "portfolio_created"
  | "portfolio_verified"

export type CrystalMutation = {
  type: CrystalMutationType
  source_ref: string
  mutation_hash: string
}

export type CrystalArtifactV0 = {
  crystal_version: "crystal_artifact.v0"
  receipt_root: string
  portfolio_root: string
  mutation_count: number
  mutations: CrystalMutation[]
  crystal_hash: string
  svg?: string
  rendered_at?: string
  color?: string
}

export type CrystalBuildInput = {
  portableProofObject: PortableProofObjectV0
  chronicleEntry: ChronicleEntryV0
  chroniclePortfolio: ChroniclePortfolioV0
}

export type CrystalQrEnvelopeV0 = {
  crystal_version: "crystal_artifact.v0"
  receipt_root: string
  mutation_hashes: string[]
  crystal_hash: string
}

export type CrystalBuildResult = {
  artifact: CrystalArtifactV0
  defects: CrystalDefect[]
  svg: string
  qrPayload: string
  qrEnvelope: CrystalQrEnvelopeV0
}

export type CrystalDefectType =
  | "hash_mismatch"
  | "broken_chain"
  | "root_inconsistency"
  | "incomplete_history"

export type CrystalDefect = {
  type: CrystalDefectType
  detail: string
}
