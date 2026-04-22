import { describe, expect, it } from "vitest";
import { Bm25OnlyProvider } from "../../src/embedding/bm25-only.provider.js";
import { EmbeddingFallbackChain } from "../../src/embedding/fallback-chain.js";
import type { EmbeddingProvider } from "../../src/embedding/types.js";

class FakeActiveProvider implements EmbeddingProvider {
	readonly name = "gemini" as const;
	readonly dimension = 3;
	readonly isActive = true;
	calls = 0;
	constructor(private readonly impl: () => Promise<number[]>) {}
	async embed(_text: string): Promise<number[]> {
		this.calls++;
		return this.impl();
	}
	async embedBatch(texts: string[]): Promise<number[][]> {
		return Promise.all(texts.map(() => this.embed("")));
	}
}

describe("EmbeddingFallbackChain", () => {
	it("returns empty vector for bm25-only (no-op)", async () => {
		const chain = new EmbeddingFallbackChain([new Bm25OnlyProvider()]);
		const { vector, provider } = await chain.embed("query");
		expect(vector).toEqual([]);
		expect(provider).toBe("bm25-only");
	});

	it("uses primary provider when healthy", async () => {
		const primary = new FakeActiveProvider(async () => [0.1, 0.2, 0.3]);
		const chain = new EmbeddingFallbackChain([primary, new Bm25OnlyProvider()]);
		const { vector, provider } = await chain.embed("q");
		expect(vector).toEqual([0.1, 0.2, 0.3]);
		expect(provider).toBe("gemini");
		expect(primary.calls).toBe(1);
	});

	it("falls through to next provider on persistent failure", async () => {
		const failing = new FakeActiveProvider(() => Promise.reject(new Error("down")));
		const chain = new EmbeddingFallbackChain([failing, new Bm25OnlyProvider()], {
			retryAttempts: 2,
			retryBaseDelayMs: 1,
			circuitFailureThreshold: 1,
		});
		const { vector, provider } = await chain.embed("q");
		expect(vector).toEqual([]);
		expect(provider).toBe("bm25-only");
	});

	it("breaker prevents retries after threshold is hit", async () => {
		const failing = new FakeActiveProvider(() => Promise.reject(new Error("down")));
		const chain = new EmbeddingFallbackChain([failing, new Bm25OnlyProvider()], {
			retryAttempts: 2,
			retryBaseDelayMs: 1,
			circuitFailureThreshold: 1,
			circuitCooldownMs: 60_000,
		});
		await chain.embed("q1");
		const callsAfterFirst = failing.calls;
		await chain.embed("q2");
		// Breaker opened → second call short-circuits to bm25-only
		expect(failing.calls).toBe(callsAfterFirst);
	});

	it("primary getter returns first provider", () => {
		const primary = new FakeActiveProvider(async () => [1]);
		const chain = new EmbeddingFallbackChain([primary, new Bm25OnlyProvider()]);
		expect(chain.primary?.name).toBe("gemini");
	});
});
