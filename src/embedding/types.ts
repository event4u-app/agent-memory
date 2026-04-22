/**
 * Embedding provider contract.
 *
 * Implementations must be deterministic for identical input or clearly document
 * otherwise. Callers rely on dimension stability across a single DB instance.
 */

export type EmbeddingProviderName = "bm25-only" | "local" | "gemini" | "openai" | "voyage";

export interface EmbeddingProvider {
	/** Unique name used in logs + config. */
	readonly name: EmbeddingProviderName;
	/** Vector dimension (0 for bm25-only — vector search is skipped). */
	readonly dimension: number;
	/** Whether this provider actually produces embeddings (false for bm25-only). */
	readonly isActive: boolean;
	/** Compute a single embedding. Returns empty array for no-op providers. */
	embed(text: string): Promise<number[]>;
	/** Compute batch embeddings. Default implementation loops embed(). */
	embedBatch(texts: string[]): Promise<number[][]>;
}

export interface EmbeddingResult {
	vector: number[];
	provider: EmbeddingProviderName;
}
