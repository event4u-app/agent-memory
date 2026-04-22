// === Memory Types ===

export const MEMORY_TYPES = [
	"architecture_decision",
	"domain_rule",
	"coding_convention",
	"bug_pattern",
	"refactoring_note",
	"integration_constraint",
	"deployment_warning",
	"test_strategy",
	"glossary_entry",
] as const;

export type MemoryType = (typeof MEMORY_TYPES)[number];

// === Impact Levels ===

export const IMPACT_LEVELS = ["critical", "high", "normal", "low"] as const;
export type ImpactLevel = (typeof IMPACT_LEVELS)[number];

// === Knowledge Classes ===

export const KNOWLEDGE_CLASSES = ["evergreen", "semi_stable", "volatile"] as const;
export type KnowledgeClass = (typeof KNOWLEDGE_CLASSES)[number];

// === Consolidation Tiers ===

export const CONSOLIDATION_TIERS = ["working", "episodic", "semantic", "procedural"] as const;
export type ConsolidationTier = (typeof CONSOLIDATION_TIERS)[number];

// === Trust Statuses ===

export const TRUST_STATUSES = [
	"quarantine",
	"validated",
	"stale",
	"invalidated",
	"rejected",
	"poisoned",
	"archived",
] as const;

export type TrustStatus = (typeof TRUST_STATUSES)[number];

// === Valid Status Transitions ===

export const VALID_TRANSITIONS: Record<TrustStatus, readonly TrustStatus[]> = {
	quarantine: ["validated", "rejected"],
	validated: ["stale", "invalidated", "poisoned", "archived"],
	stale: ["validated", "invalidated", "poisoned", "archived"],
	invalidated: ["archived", "poisoned"],
	rejected: ["archived"],
	poisoned: ["archived"],
	archived: [],
} as const;

// === Evidence Types ===

export const EVIDENCE_KINDS = ["file", "commit", "test", "adr", "documentation", "symbol"] as const;
export type EvidenceKind = (typeof EVIDENCE_KINDS)[number];

// === Core Interfaces ===

export interface MemoryEntry {
	id: string;
	type: MemoryType;
	title: string;
	summary: string;
	details: string | null;
	scope: MemoryScope;
	impactLevel: ImpactLevel;
	knowledgeClass: KnowledgeClass;
	consolidationTier: ConsolidationTier;
	trust: TrustInfo;
	embeddingText: string;
	embedding: number[] | null;
	accessCount: number;
	lastAccessedAt: Date | null;
	createdBy: string;
	createdInTask: string | null;
	createdAt: Date;
	updatedAt: Date;
	promotionMetadata: PromotionMetadata;
}

/**
 * Proposal-time metadata carried from `propose()` into `promote()` gate checks.
 * See `agents/roadmaps/archive/from-agent-config/road-to-promotion-flow.md`
 * ("Gate criteria" section).
 */
export interface PromotionMetadata {
	/** Three+ plausible future scenarios this entry will inform (3-future-decisions heuristic) */
	futureScenarios?: string[];
	/** Origin reference (incident id, PR, ADR) carried from propose() */
	source?: string;
	/** Whether the extraction-guard (tests/quality tools/no-only-deletions) was clean at proposal time */
	gateCleanAtProposal?: boolean;
}

/** Minimum future-decision scenarios required to promote above Low impact */
export const MIN_FUTURE_SCENARIOS = 3;

export interface MemoryScope {
	repository: string;
	boundedContext?: string;
	files: string[];
	symbols: string[];
	modules: string[];
}

export interface TrustInfo {
	status: TrustStatus;
	score: number;
	validatedAt: Date | null;
	expiresAt: Date;
}

export interface MemoryEvidence {
	id: string;
	memoryEntryId: string;
	kind: EvidenceKind;
	ref: string;
	details: string | null;
	verifiedAt: Date | null;
	createdAt: Date;
}

export interface StatusChange {
	id: string;
	memoryEntryId: string;
	fromStatus: TrustStatus;
	toStatus: TrustStatus;
	reason: string;
	triggeredBy: string;
	createdAt: Date;
}

export interface Contradiction {
	id: string;
	entryAId: string;
	entryBId: string;
	description: string;
	resolvedAt: Date | null;
	resolution: string | null;
	createdAt: Date;
}

// === Observation (Working Memory) ===

export interface Observation {
	id: string;
	sessionId: string;
	hash: string;
	content: string;
	source: string;
	createdAt: Date;
}

// === TTL Config ===

export const TTL_DAYS: Record<KnowledgeClass, number> = {
	evergreen: 90,
	semi_stable: 30,
	volatile: 7,
} as const;

export const TTL_BOOST_PER_10_ACCESSES: Record<KnowledgeClass, number> = {
	evergreen: 30,
	semi_stable: 7,
	volatile: 2,
} as const;

export const TTL_CAP_DAYS: Record<KnowledgeClass, number> = {
	evergreen: 365,
	semi_stable: 90,
	volatile: 30,
} as const;

// === Impact Level Config ===

export const MIN_EVIDENCE_COUNT: Record<ImpactLevel, number> = {
	critical: 2,
	high: 1,
	normal: 1,
	low: 0,
} as const;

export const TRUST_SCORE_CAP_SINGLE_EVIDENCE: Record<ImpactLevel, number> = {
	critical: 0.7,
	high: 0.85,
	normal: 1.0,
	low: 1.0,
} as const;
