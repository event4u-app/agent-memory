// B3 · runtime-trust — aggregates open maintenance cases into a single
// digest so operators get one place to triage instead of chasing
// `diagnose`, `contradictions`, and `poison` separately. Consumers:
// `memory review [--weekly]` CLI + `memory_review` MCP tool.
//
// Pure: takes already-fetched rows, returns the `review-weekly-v1`
// envelope. The CLI/MCP callers do the DB work + the defer-filter.

import type { ImpactLevel } from "../types.js";

export type ReviewCaseKind = "stale_high_value" | "contradiction" | "poison_candidate";

export interface StaleHighValueCase {
	kind: "stale_high_value";
	case_id: string; // `stale:${entry_id}`
	entry_id: string;
	title: string;
	impact_level: ImpactLevel;
	trust_score: number;
	days_since_validation: number;
	hint: string;
}

export interface ContradictionCase {
	kind: "contradiction";
	case_id: string; // `contradiction:${id}`
	contradiction_id: string;
	entry_a: { id: string; title: string };
	entry_b: { id: string; title: string };
	description: string;
	created_at: string;
	hint: string;
}

export interface PoisonCandidateCase {
	kind: "poison_candidate";
	case_id: string; // `poison:${entry_id}`
	entry_id: string;
	title: string;
	trust_score: number;
	invalidation_count: number;
	hint: string;
}

export type ReviewCase = StaleHighValueCase | ContradictionCase | PoisonCandidateCase;

export interface ReviewDigestInputs {
	staleHighValue: Array<{
		id: string;
		title: string;
		impactLevel: ImpactLevel;
		trustScore: number;
		daysSinceValidation: number;
	}>;
	contradictions: Array<{
		id: string;
		entryAId: string;
		entryATitle: string;
		entryBId: string;
		entryBTitle: string;
		description: string;
		createdAt: Date;
	}>;
	poisonCandidates: Array<{
		entryId: string;
		title: string;
		trustScore: number;
		invalidationCount: number;
	}>;
	deferredCaseIds?: ReadonlySet<string>;
	generatedAt?: Date;
}

export interface ReviewDigestV1 {
	contract_version: "review-weekly-v1";
	generated_at: string;
	summary: {
		stale_high_value: number;
		contradictions: number;
		poison_candidates: number;
		deferred: number;
	};
	cases: ReviewCase[];
}

export function buildReviewDigest(inputs: ReviewDigestInputs): ReviewDigestV1 {
	const {
		staleHighValue,
		contradictions,
		poisonCandidates,
		deferredCaseIds = new Set<string>(),
		generatedAt = new Date(),
	} = inputs;

	const stale: StaleHighValueCase[] = staleHighValue.map((r) => ({
		kind: "stale_high_value" as const,
		case_id: `stale:${r.id}`,
		entry_id: r.id,
		title: r.title,
		impact_level: r.impactLevel,
		trust_score: r.trustScore,
		days_since_validation: Math.round(r.daysSinceValidation),
		hint: "Refresh evidence or deprecate — high-impact entry has gone stale",
	}));

	const contra: ContradictionCase[] = contradictions.map((r) => ({
		kind: "contradiction" as const,
		case_id: `contradiction:${r.id}`,
		contradiction_id: r.id,
		entry_a: { id: r.entryAId, title: r.entryATitle },
		entry_b: { id: r.entryBId, title: r.entryBTitle },
		description: r.description,
		created_at: r.createdAt.toISOString(),
		hint: "Resolve: keep A, keep B, keep both, or reject both",
	}));

	const poison: PoisonCandidateCase[] = poisonCandidates.map((r) => ({
		kind: "poison_candidate" as const,
		case_id: `poison:${r.entryId}`,
		entry_id: r.entryId,
		title: r.title,
		trust_score: r.trustScore,
		invalidation_count: r.invalidationCount,
		hint: "Repeated invalidations — consider `memory poison` or deprecate",
	}));

	const all: ReviewCase[] = [...stale, ...contra, ...poison];
	const cases = all.filter((c) => !deferredCaseIds.has(c.case_id));
	const deferred = all.length - cases.length;

	return {
		contract_version: "review-weekly-v1",
		generated_at: generatedAt.toISOString(),
		summary: {
			stale_high_value: cases.filter((c) => c.kind === "stale_high_value").length,
			contradictions: cases.filter((c) => c.kind === "contradiction").length,
			poison_candidates: cases.filter((c) => c.kind === "poison_candidate").length,
			deferred,
		},
		cases,
	};
}
