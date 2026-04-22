import type { MemoryEntry } from "../types.js";

/**
 * Progressive Disclosure — 3-layer retrieval for token efficiency.
 *
 * L1 (Index): ID + title + type + tier + trust score — minimal, for listing
 * L2 (Timeline): L1 + summary + scope + timestamps — for context
 * L3 (Full): Everything including details and embedding text — for deep use
 */

export type DisclosureLevel = "index" | "timeline" | "full";

/** L1: Minimal index entry — just enough to identify and rank */
export interface L1IndexEntry {
	id: string;
	title: string;
	type: string;
	consolidationTier: string;
	trustScore: number;
	trustStatus: string;
	isStale: boolean;
}

/** L2: Timeline entry — adds context for decision-making */
export interface L2TimelineEntry extends L1IndexEntry {
	summary: string;
	scope: {
		repository: string | null;
		modules: string[];
	};
	impactLevel: string;
	knowledgeClass: string;
	createdAt: Date;
	updatedAt: Date;
	lastAccessedAt: Date | null;
	accessCount: number;
}

/** L3: Full entry — complete data for deep use */
export interface L3FullEntry extends L2TimelineEntry {
	details: string | null;
	embeddingText: string;
	scope: {
		repository: string | null;
		files: string[];
		symbols: string[];
		modules: string[];
	};
	createdBy: string;
	createdInTask: string | null;
}

/** Extract L1 index data from a full memory entry */
export function toL1(entry: MemoryEntry): L1IndexEntry {
	return {
		id: entry.id,
		title: entry.title,
		type: entry.type,
		consolidationTier: entry.consolidationTier,
		trustScore: entry.trust.score,
		trustStatus: entry.trust.status,
		isStale: entry.trust.status === "stale",
	};
}

/** Extract L2 timeline data from a full memory entry */
export function toL2(entry: MemoryEntry): L2TimelineEntry {
	return {
		...toL1(entry),
		summary: entry.summary,
		scope: {
			repository: entry.scope.repository,
			modules: entry.scope.modules,
		},
		impactLevel: entry.impactLevel,
		knowledgeClass: entry.knowledgeClass,
		createdAt: entry.createdAt,
		updatedAt: entry.updatedAt,
		lastAccessedAt: entry.lastAccessedAt,
		accessCount: entry.accessCount,
	};
}

/** Extract L3 full data from a full memory entry */
export function toL3(entry: MemoryEntry): L3FullEntry {
	return {
		...toL2(entry),
		details: entry.details,
		embeddingText: entry.embeddingText,
		scope: {
			repository: entry.scope.repository,
			files: entry.scope.files,
			symbols: entry.scope.symbols,
			modules: entry.scope.modules,
		},
		createdBy: entry.createdBy,
		createdInTask: entry.createdInTask,
	};
}

/** Project entries at the requested disclosure level */
export function project(
	entries: MemoryEntry[],
	level: DisclosureLevel,
): (L1IndexEntry | L2TimelineEntry | L3FullEntry)[] {
	switch (level) {
		case "index":
			return entries.map(toL1);
		case "timeline":
			return entries.map(toL2);
		case "full":
			return entries.map(toL3);
	}
}

/**
 * Estimate token count for a projected entry.
 * Rough heuristic: ~4 chars per token (English text).
 */
export function estimateTokens(entry: L1IndexEntry | L2TimelineEntry | L3FullEntry): number {
	const json = JSON.stringify(entry);
	return Math.ceil(json.length / 4);
}

/**
 * Apply token budget: return as many entries as fit within the budget.
 * Always includes at least 1 entry (even if it exceeds budget).
 */
export function applyTokenBudget<T extends L1IndexEntry>(
	entries: T[],
	budget: number,
): { included: T[]; truncated: number; tokensUsed: number } {
	if (entries.length === 0) return { included: [], truncated: 0, tokensUsed: 0 };

	const included: T[] = [];
	let tokensUsed = 0;

	for (const entry of entries) {
		const tokens = estimateTokens(entry);

		// Always include at least 1 entry
		if (included.length > 0 && tokensUsed + tokens > budget) {
			break;
		}

		included.push(entry);
		tokensUsed += tokens;
	}

	return {
		included,
		truncated: entries.length - included.length,
		tokensUsed,
	};
}
