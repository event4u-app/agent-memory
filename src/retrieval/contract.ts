/**
 * Cross-repo retrieval contract v1.
 *
 * Contract between `agent-memory` (this package) and consumers like `agent-config`.
 * See `agents/roadmaps/from-agent-config/road-to-retrieval-contract.md` for spec.
 *
 * Evolution rules:
 * - Additive fields only in minor versions
 * - Breaking changes go through a deprecation window (one minor announces, next major removes)
 * - This file is the canonical contract — drift = bug
 */

import type { L1IndexEntry, L2TimelineEntry, L3FullEntry } from "./progressive-disclosure.js";

export const CONTRACT_VERSION = 1 as const;

/** Per-slice status code. */
export type SliceStatus = "ok" | "timeout" | "unknown_type" | "misconfigured" | "internal";

/** Envelope-level status. */
export type EnvelopeStatus = "ok" | "partial" | "error";

/** Health backend status. */
export type HealthStatus = "ok" | "degraded" | "error";

/** Request: retrieve() */
export interface RetrieveRequestV1 {
	/** One or more memory type names — unknown types return slice-level unknown_type */
	types: string[];
	/** Scope filters: repository, module, tags, etc. */
	keys?: Record<string, unknown>;
	/** Hard cap across all types combined */
	limit?: number;
	/** Total budget in ms — slices cancelled individually on breach */
	timeout_ms?: number;
}

/** Response entry — additive-only across minor versions. */
export interface ContractEntry {
	id: string;
	type: string;
	source: "repo" | "operational";
	confidence: number;
	trust?: number;
	body: Record<string, unknown>;
	last_validated?: string;
	shadowed_by?: string | null;
}

/** Per-slice summary. */
export interface SliceSummary {
	status: SliceStatus;
	count: number;
	/** Human-readable message — only when status !== "ok" */
	message?: string;
}

/** Slice-level error detail. */
export interface SliceError {
	type: string;
	code: SliceStatus;
	message: string;
}

/** Response: retrieve() */
export interface RetrieveResponseV1 {
	contract_version: typeof CONTRACT_VERSION;
	status: EnvelopeStatus;
	entries: ContractEntry[];
	slices: Record<string, SliceSummary>;
	errors: SliceError[];
}

/** Response: health() */
export interface HealthResponseV1 {
	contract_version: typeof CONTRACT_VERSION;
	status: HealthStatus;
	backend_version: string;
	features: string[];
	/** Optional extended info (minor-additive). */
	latency_ms?: number;
	counts?: Record<string, number>;
}

/** Feature flags this backend advertises — consumed by agent-config detection helper. */
export const BACKEND_FEATURES = [
	"trust-scoring",
	"decay",
	"quarantine",
	"contradiction-detection",
	"semantic-drift",
	"progressive-disclosure",
	"privacy-filter",
] as const satisfies readonly string[];

/**
 * Convert internal retrieval result entries into the contract envelope.
 * Accepts the internal L1/L2/L3 projections and emits type-stable `ContractEntry` records.
 */
export function toContractEntry(
	entry: L1IndexEntry | L2TimelineEntry | L3FullEntry,
	source: "repo" | "operational" = "operational",
): ContractEntry {
	const body: Record<string, unknown> = { title: entry.title };
	if ("summary" in entry) body.summary = entry.summary;
	if ("scope" in entry) body.scope = entry.scope;
	if ("details" in entry) body.details = (entry as L3FullEntry).details;
	if ("embeddingText" in entry) body.embedding_text = (entry as L3FullEntry).embeddingText;

	const lastValidated =
		"updatedAt" in entry && entry.updatedAt ? entry.updatedAt.toISOString() : undefined;

	return {
		id: entry.id,
		type: entry.type,
		source,
		confidence: entry.trustScore,
		trust: entry.trustScore,
		body,
		last_validated: lastValidated,
		shadowed_by: null,
	};
}

/**
 * Compute envelope status from per-slice statuses.
 *
 *   ok      ⇔ every slice is ok
 *   error   ⇔ every slice failed and no entries returned
 *   partial ⇔ anything in between (at least one ok + at least one failed)
 */
export function computeEnvelopeStatus(
	slices: Record<string, SliceSummary>,
	entryCount: number,
): EnvelopeStatus {
	const values = Object.values(slices);
	if (values.length === 0) return entryCount > 0 ? "ok" : "error";
	const allOk = values.every((s) => s.status === "ok");
	if (allOk) return "ok";
	const anyOk = values.some((s) => s.status === "ok");
	if (!anyOk && entryCount === 0) return "error";
	return "partial";
}
