import type { EmbeddingProvider } from "./types.js";

/**
 * No-op provider. Vector search is skipped entirely; retrieval falls back to BM25.
 */
export class Bm25OnlyProvider implements EmbeddingProvider {
	readonly name = "bm25-only" as const;
	readonly dimension = 0;
	readonly isActive = false;

	async embed(_text: string): Promise<number[]> {
		return [];
	}

	async embedBatch(texts: string[]): Promise<number[][]> {
		return texts.map(() => []);
	}
}
