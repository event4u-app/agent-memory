import type { MemoryEntry, MemoryEvidence } from "../../types.js";

// === Validator Result ===

export interface ValidatorResult {
  /** Validator name (e.g. "file-exists", "symbol-exists") */
  validator: string;
  /** Whether validation passed */
  passed: boolean;
  /** Confidence level (0.0–1.0) — how strongly this result should influence trust */
  confidence: number;
  /** Human-readable reason */
  reason: string;
  /** Evidence IDs that were verified (or failed verification) */
  checkedEvidenceIds: string[];
}

// === Validator Interface ===

export interface EvidenceValidator {
  /** Unique validator name */
  readonly name: string;
  /**
   * Validate a memory entry's evidence.
   * Returns a result indicating pass/fail with confidence and reason.
   */
  validate(entry: MemoryEntry, evidence: MemoryEvidence[]): Promise<ValidatorResult>;
}

// === Validation Summary ===

export interface ValidationSummary {
  /** All individual validator results */
  results: ValidatorResult[];
  /** Overall decision: should the entry be validated or rejected? */
  decision: "validate" | "reject";
  /** Calculated trust score for the entry */
  trustScore: number;
  /** Reason for the decision */
  reason: string;
  /** Whether any unresolved contradictions were found */
  hasContradictions: boolean;
}
