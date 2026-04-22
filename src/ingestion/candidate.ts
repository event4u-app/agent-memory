import type {
	ConsolidationTier,
	EvidenceKind,
	ImpactLevel,
	KnowledgeClass,
	MemoryScope,
	MemoryType,
} from "../types.js";

// === Ingestion Candidate ===

export interface IngestionCandidate {
	/** Memory type (e.g. architecture_decision, bug_pattern) */
	type: MemoryType;
	/** Short title */
	title: string;
	/** One-paragraph summary */
	summary: string;
	/** Optional longer details */
	details?: string;
	/** Scope: repository, files, symbols, modules */
	scope: MemoryScope;
	/** Text used for embedding generation */
	embeddingText: string;
	/** Source of the candidate (e.g. "file-scanner", "git-reader", "doc-reader") */
	source: string;
	/** Evidence references to attach */
	evidence: CandidateEvidence[];
}

export interface CandidateEvidence {
	kind: EvidenceKind;
	ref: string;
	details?: string;
}

// === Auto-Classification ===

/** Map memory type → default impact level */
const TYPE_TO_IMPACT: Record<MemoryType, ImpactLevel> = {
	architecture_decision: "critical",
	domain_rule: "critical",
	integration_constraint: "high",
	deployment_warning: "high",
	bug_pattern: "normal",
	refactoring_note: "normal",
	test_strategy: "normal",
	coding_convention: "low",
	glossary_entry: "low",
};

/** Map memory type → default knowledge class */
const TYPE_TO_KNOWLEDGE_CLASS: Record<MemoryType, KnowledgeClass> = {
	architecture_decision: "evergreen",
	domain_rule: "evergreen",
	coding_convention: "evergreen",
	glossary_entry: "evergreen",
	integration_constraint: "semi_stable",
	deployment_warning: "semi_stable",
	test_strategy: "semi_stable",
	bug_pattern: "volatile",
	refactoring_note: "volatile",
};

/** Map source → default consolidation tier */
const SOURCE_TO_TIER: Record<string, ConsolidationTier> = {
	observation: "working",
	"session-summary": "episodic",
	"file-scanner": "semantic",
	"doc-reader": "semantic",
	"git-reader": "semantic",
	"symbol-extractor": "semantic",
	manual: "semantic",
};

export interface Classification {
	impactLevel: ImpactLevel;
	knowledgeClass: KnowledgeClass;
	consolidationTier: ConsolidationTier;
}

/**
 * Auto-classify a candidate based on its type and source.
 * These are defaults — can be overridden manually.
 */
export function classifyCandidate(candidate: IngestionCandidate): Classification {
	return {
		impactLevel: TYPE_TO_IMPACT[candidate.type],
		knowledgeClass: TYPE_TO_KNOWLEDGE_CLASS[candidate.type],
		consolidationTier: SOURCE_TO_TIER[candidate.source] ?? "semantic",
	};
}
