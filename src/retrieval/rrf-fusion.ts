import { logger } from "../utils/logger.js";

/**
 * Reciprocal Rank Fusion (RRF) — combines multiple ranked lists.
 * Formula: RRF(d) = Σ 1/(k + rank_i(d)) for each stream i.
 *
 * k=60 is the standard constant from the original paper (Cormack et al. 2009).
 */
const DEFAULT_K = 60;

export interface RankedItem {
  id: string;
  score: number;
}

export interface FusionOptions {
  /** RRF constant k (default: 60) */
  k?: number;
  /** Maximum results to return */
  limit?: number;
}

export interface FusionResult {
  id: string;
  /** Combined RRF score */
  score: number;
  /** Individual stream scores (for debugging) */
  streamScores: Record<string, number>;
}

/**
 * Fuse multiple ranked result streams using Reciprocal Rank Fusion.
 *
 * @param streams - Named ranked result lists (e.g., { bm25: [...], vector: [...] })
 * @param options - Fusion parameters
 */
export function rrfFuse(
  streams: Record<string, RankedItem[]>,
  options: FusionOptions = {}
): FusionResult[] {
  const k = options.k ?? DEFAULT_K;
  const limit = options.limit ?? 20;

  const fusedScores = new Map<
    string,
    { score: number; streamScores: Record<string, number> }
  >();

  for (const [streamName, items] of Object.entries(streams)) {
    for (let rank = 0; rank < items.length; rank++) {
      const item = items[rank]!;
      const rrfScore = 1 / (k + rank + 1); // rank is 0-based, formula uses 1-based

      const existing = fusedScores.get(item.id);
      if (existing) {
        existing.score += rrfScore;
        existing.streamScores[streamName] = rrfScore;
      } else {
        fusedScores.set(item.id, {
          score: rrfScore,
          streamScores: { [streamName]: rrfScore },
        });
      }
    }
  }

  const results: FusionResult[] = Array.from(fusedScores.entries()).map(
    ([id, data]) => ({
      id,
      score: data.score,
      streamScores: data.streamScores,
    })
  );

  results.sort((a, b) => b.score - a.score);

  logger.debug(
    { streamCount: Object.keys(streams).length, totalCandidates: fusedScores.size, limit },
    "RRF fusion completed"
  );

  return results.slice(0, limit);
}
