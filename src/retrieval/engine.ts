import type { Sql } from "postgres";
import { shouldRefreshOnHit } from "../trust/decay.js";
import { applyExpiryFilter } from "../trust/expiry.js";
import type {
	ConsolidationTier,
	MemoryEntry,
	MemoryType,
	TrustStatus,
} from "../types.js";
import { logger } from "../utils/logger.js";
import { BM25Scorer } from "./bm25.js";
import {
	applyTokenBudget,
	type DisclosureLevel,
	type L1IndexEntry,
	type L2TimelineEntry,
	type L3FullEntry,
	project,
} from "./progressive-disclosure.js";
import { type FusionResult, rrfFuse } from "./rrf-fusion.js";
import { vectorSearch } from "./vector-search.js";

// --- Trust-aware ranking weights ---

const TIER_WEIGHT: Record<ConsolidationTier, number> = {
	procedural: 1.0,
	semantic: 0.75,
	episodic: 0.5,
	working: 0.25,
};

const TRUST_RANKING_WEIGHT = 0.3;
const ACCESS_RANKING_WEIGHT = 0.1;
const TIER_RANKING_WEIGHT = 0.1;

// --- Configuration ---

const DEFAULT_TOKEN_BUDGET = 2000;
const DEFAULT_TRUST_THRESHOLD = 0.6;
const LOW_TRUST_THRESHOLD = 0.3;
const DEFAULT_LIMIT = 20;

// --- Types ---

export interface RetrievalFilters {
	repository?: string;
	module?: string;
	types?: MemoryType[];
	tiers?: ConsolidationTier[];
	minTrustScore?: number;
	excludeStatuses?: TrustStatus[];
}

export interface RetrievalOptions {
	/** Query text for BM25 + vector search */
	query: string;
	/** Query embedding for vector search (optional, skips vector if missing) */
	queryEmbedding?: number[];
	/** Metadata filters */
	filters?: RetrievalFilters;
	/** Disclosure level (default: timeline) */
	level?: DisclosureLevel;
	/** Token budget (default: 2000) */
	tokenBudget?: number;
	/** Max results (default: 20) */
	limit?: number;
	/** Enable low-trust mode (threshold 0.3 instead of 0.6, results marked) */
	lowTrustMode?: boolean;
}

export interface RetrievalResponse {
	entries: (L1IndexEntry | L2TimelineEntry | L3FullEntry)[];
	metadata: {
		totalCandidates: number;
		filtered: number;
		staleCount: number;
		needsStaling: string[];
		truncated: number;
		tokensUsed: number;
		level: DisclosureLevel;
		lowTrustMode: boolean;
	};
}

/**
 * Main retrieval engine combining BM25 + vector search with trust enforcement.
 */
export class RetrievalEngine {
	private readonly sql: Sql;
	private bm25: BM25Scorer;

	constructor(sql: Sql) {
		this.sql = sql;
		this.bm25 = new BM25Scorer();
	}

	/** Index a memory entry for BM25 search */
	indexEntry(entry: MemoryEntry): void {
		const text = [entry.title, entry.summary, entry.details ?? ""].join(" ");
		this.bm25.addDocument(entry.id, text);
	}

	/** Remove an entry from the BM25 index */
	removeFromIndex(id: string): void {
		this.bm25.removeDocument(id);
	}

	/** Rebuild BM25 index from entries */
	rebuildIndex(entries: MemoryEntry[]): void {
		this.bm25 = new BM25Scorer();
		for (const entry of entries) {
			this.indexEntry(entry);
		}
		logger.info({ count: entries.length }, "BM25 index rebuilt");
	}

	/**
	 * Retrieve memory entries matching a query with full trust enforcement.
	 */
	async retrieve(
		allEntries: MemoryEntry[],
		options: RetrievalOptions,
	): Promise<RetrievalResponse> {
		const level = options.level ?? "timeline";
		const tokenBudget = options.tokenBudget ?? DEFAULT_TOKEN_BUDGET;
		const limit = options.limit ?? DEFAULT_LIMIT;
		const trustThreshold = options.lowTrustMode
			? LOW_TRUST_THRESHOLD
			: (options.filters?.minTrustScore ?? DEFAULT_TRUST_THRESHOLD);

		// 1. Apply expiry filter — auto-stale expired entries
		const expiryResult = applyExpiryFilter(allEntries);

		// 2. Combine servable + stale (stale served with warning)
		const candidates = [...expiryResult.servable, ...expiryResult.staleWarning];

		// 3. Apply metadata filters
		const filtered = this.applyFilters(
			candidates,
			options.filters,
			trustThreshold,
		);

		// 4. BM25 search
		const bm25Results = this.bm25.search(options.query, limit * 2);

		// 5. Vector search (if embedding provided)
		let vectorResults: { id: string; score: number }[] = [];
		if (options.queryEmbedding && options.queryEmbedding.length > 0) {
			vectorResults = await vectorSearch(this.sql, options.queryEmbedding, {
				limit: limit * 2,
			});
		}

		// 6. RRF fusion
		const fused = rrfFuse(
			{ bm25: bm25Results, vector: vectorResults },
			{ limit },
		);

		// 7. Resolve fused IDs to full entries, apply trust-aware re-ranking
		const entryMap = new Map(filtered.map((e) => [e.id, e]));
		const fusedWithEntries: { entry: MemoryEntry; fusionScore: number }[] = [];
		for (const result of fused) {
			const entry = entryMap.get(result.id);
			if (entry) fusedWithEntries.push({ entry, fusionScore: result.score });
		}

		// 8. Trust-aware re-ranking: blend fusion score with trust signals
		const rankedEntries = fusedWithEntries
			.map(({ entry, fusionScore }) => ({
				entry,
				finalScore: this.computeFinalScore(entry, fusionScore),
			}))
			.sort((a, b) => b.finalScore - a.finalScore)
			.map(({ entry }) => entry);

		// 9. Record access for returned entries (Ebbinghaus strengthening)
		//    and refresh validated_at when the retrieval-hit cooldown has elapsed.
		for (const entry of rankedEntries) {
			const reference = entry.trust.validatedAt ?? entry.createdAt;
			const refresh = shouldRefreshOnHit(reference);
			await this.recordAccess(entry.id, refresh);
		}

		// 10. Progressive disclosure
		const projected = project(rankedEntries, level);

		// 11. Token budget
		const budgeted = applyTokenBudget(projected as L1IndexEntry[], tokenBudget);

		return {
			entries: budgeted.included,
			metadata: {
				totalCandidates: allEntries.length,
				filtered: expiryResult.filtered + (candidates.length - filtered.length),
				staleCount: expiryResult.staleWarning.length,
				needsStaling: expiryResult.needsStaling,
				truncated: budgeted.truncated,
				tokensUsed: budgeted.tokensUsed,
				level,
				lowTrustMode: options.lowTrustMode ?? false,
			},
		};
	}

	/** Apply metadata filters and trust threshold */
	private applyFilters(
		entries: MemoryEntry[],
		filters: RetrievalFilters | undefined,
		trustThreshold: number,
	): MemoryEntry[] {
		return entries.filter((entry) => {
			// Trust threshold enforcement
			if (entry.trust.score < trustThreshold) return false;

			if (!filters) return true;

			if (filters.repository && entry.scope.repository !== filters.repository)
				return false;
			if (filters.module && !entry.scope.modules.includes(filters.module))
				return false;
			if (filters.types && !filters.types.includes(entry.type)) return false;
			if (filters.tiers && !filters.tiers.includes(entry.consolidationTier))
				return false;
			if (
				filters.excludeStatuses &&
				filters.excludeStatuses.includes(entry.trust.status)
			)
				return false;

			return true;
		});
	}

	/**
	 * Compute final ranking score blending RRF fusion score with trust signals.
	 * Higher trust, higher tier, more accesses = higher final score.
	 */
	private computeFinalScore(entry: MemoryEntry, fusionScore: number): number {
		const trustBoost = entry.trust.score * TRUST_RANKING_WEIGHT;
		const tierBoost =
			(TIER_WEIGHT[entry.consolidationTier] ?? 0.5) * TIER_RANKING_WEIGHT;
		const accessBoost =
			Math.min(entry.accessCount / 100, 1) * ACCESS_RANKING_WEIGHT;

		// Fusion score is the primary signal (~50%), trust signals are secondary
		return (
			fusionScore *
				(1 -
					TRUST_RANKING_WEIGHT -
					ACCESS_RANKING_WEIGHT -
					TIER_RANKING_WEIGHT) +
			trustBoost +
			tierBoost +
			accessBoost
		);
	}

	/**
	 * Record access for Ebbinghaus strengthening.
	 * When `refreshValidated` is true, also bump `validated_at` so the
	 * retrieval counts as a validation signal (max 1 refresh per entry
	 * per `REFRESH_COOLDOWN_DAYS` — enforced by the caller).
	 * Non-blocking — errors are logged but don't fail retrieval.
	 */
	private async recordAccess(
		id: string,
		refreshValidated = false,
	): Promise<void> {
		try {
			if (refreshValidated) {
				await this.sql`
          UPDATE memory_entries
          SET access_count = access_count + 1,
              last_accessed_at = NOW(),
              validated_at = NOW()
          WHERE id = ${id}
        `;
			} else {
				await this.sql`
          UPDATE memory_entries
          SET access_count = access_count + 1,
              last_accessed_at = NOW()
          WHERE id = ${id}
        `;
			}
		} catch (err) {
			logger.warn({ id, err }, "Failed to record access (non-critical)");
		}
	}
}
