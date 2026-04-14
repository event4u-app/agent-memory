import type { Sql } from "postgres";
import type { MemoryEntry, ConsolidationTier, MemoryType, TrustStatus } from "../types.js";
import { BM25Scorer } from "./bm25.js";
import { vectorSearch } from "./vector-search.js";
import { rrfFuse, type FusionResult } from "./rrf-fusion.js";
import {
  type DisclosureLevel,
  type L1IndexEntry,
  type L2TimelineEntry,
  type L3FullEntry,
  project,
  applyTokenBudget,
} from "./progressive-disclosure.js";
import { applyExpiryFilter } from "../trust/expiry.js";
import { logger } from "../utils/logger.js";

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
    options: RetrievalOptions
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
    const filtered = this.applyFilters(candidates, options.filters, trustThreshold);

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
      { limit }
    );

    // 7. Resolve fused IDs to full entries (preserving fusion order)
    const entryMap = new Map(filtered.map((e) => [e.id, e]));
    const rankedEntries: MemoryEntry[] = [];
    for (const result of fused) {
      const entry = entryMap.get(result.id);
      if (entry) rankedEntries.push(entry);
    }

    // 8. Progressive disclosure
    const projected = project(rankedEntries, level);

    // 9. Token budget
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
    trustThreshold: number
  ): MemoryEntry[] {
    return entries.filter((entry) => {
      // Trust threshold enforcement
      if (entry.trust.score < trustThreshold) return false;

      if (!filters) return true;

      if (filters.repository && entry.scope.repository !== filters.repository) return false;
      if (filters.module && !entry.scope.modules.includes(filters.module)) return false;
      if (filters.types && !filters.types.includes(entry.type)) return false;
      if (filters.tiers && !filters.tiers.includes(entry.consolidationTier)) return false;
      if (filters.excludeStatuses && filters.excludeStatuses.includes(entry.trust.status))
        return false;

      return true;
    });
  }
}
