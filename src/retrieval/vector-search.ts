import type { Sql } from "postgres";
import { logger } from "../utils/logger.js";

export interface VectorSearchResult {
  id: string;
  score: number; // cosine similarity (0..1)
}

export interface VectorSearchOptions {
  /** Maximum number of results */
  limit?: number;
  /** Minimum similarity threshold (default: 0.3) */
  minSimilarity?: number;
}

/**
 * Cosine similarity search using pgvector.
 * Requires the `vector` extension and a memory_entries.embedding column.
 */
export async function vectorSearch(
  sql: Sql,
  queryEmbedding: number[],
  options: VectorSearchOptions = {}
): Promise<VectorSearchResult[]> {
  const limit = options.limit ?? 20;
  const minSimilarity = options.minSimilarity ?? 0.3;

  if (queryEmbedding.length === 0) {
    logger.warn("Empty query embedding — skipping vector search");
    return [];
  }

  // pgvector cosine distance: 1 - (a <=> b)
  // <=> returns distance (0 = identical), we want similarity (1 = identical)
  const embeddingStr = `[${queryEmbedding.join(",")}]`;

  const rows = await sql`
    SELECT
      id,
      1 - (embedding <=> ${embeddingStr}::vector) AS similarity
    FROM memory_entries
    WHERE embedding IS NOT NULL
      AND trust_status NOT IN ('quarantine', 'invalidated', 'rejected', 'poisoned', 'archived')
      AND 1 - (embedding <=> ${embeddingStr}::vector) >= ${minSimilarity}
    ORDER BY embedding <=> ${embeddingStr}::vector ASC
    LIMIT ${limit}
  `;

  const results: VectorSearchResult[] = rows.map((row) => ({
    id: row.id as string,
    score: Number(row.similarity),
  }));

  logger.debug({ count: results.length, limit }, "Vector search completed");
  return results;
}

/**
 * Compute cosine similarity between two vectors (in-memory, for testing).
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i]! * b[i]!;
    normA += a[i]! * a[i]!;
    normB += b[i]! * b[i]!;
  }

  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  if (denominator === 0) return 0;

  return dotProduct / denominator;
}
