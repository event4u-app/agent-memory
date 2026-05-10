import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { secureEmbeddingInput } from "../../src/embedding/boundary.js";
import { EmbeddingFallbackChain } from "../../src/embedding/fallback-chain.js";
import type { EmbeddingProvider } from "../../src/embedding/types.js";
import { SecretViolationError } from "../../src/security/secret-guard.js";

function stubProvider(overrides: Partial<EmbeddingProvider> = {}): EmbeddingProvider {
	return {
		name: "local",
		dimension: 4,
		isActive: true,
		embed: vi.fn(async () => [0.1, 0.2, 0.3, 0.4]),
		embedBatch: vi.fn(async () => [[0.1, 0.2, 0.3, 0.4]]),
		...overrides,
	};
}

describe("secureEmbeddingInput — unit", () => {
	it("returns clean text unchanged", () => {
		expect(secureEmbeddingInput("ordinary project prose", "reject")).toBe("ordinary project prose");
	});

	it("throws SecretViolationError under policy=reject when a secret is present", () => {
		expect(() =>
			secureEmbeddingInput("context: ghp_0123456789abcdefghijklmnopqrstuvwxyz01", "reject"),
		).toThrow(SecretViolationError);
	});

	it("scrubs the text and returns a safe copy under policy=redact", () => {
		const out = secureEmbeddingInput(
			"context: ghp_0123456789abcdefghijklmnopqrstuvwxyz01",
			"redact",
		);
		expect(out).not.toMatch(/ghp_[A-Za-z0-9_]{36}/);
		expect(out).toContain("[REDACTED:github_token]");
	});
});

describe("EmbeddingFallbackChain — secret-ingress boundary", () => {
	const originalPolicy = process.env.MEMORY_SECRET_POLICY;

	beforeEach(() => {
		// Default config.security.secretPolicy is "reject" for these tests.
		process.env.MEMORY_SECRET_POLICY = "reject";
	});

	afterEach(() => {
		if (originalPolicy === undefined) delete process.env.MEMORY_SECRET_POLICY;
		else process.env.MEMORY_SECRET_POLICY = originalPolicy;
	});

	it("throws SecretViolationError before any provider is invoked", async () => {
		const provider = stubProvider();
		const chain = new EmbeddingFallbackChain([provider]);

		await expect(
			chain.embed("leak: ghp_0123456789abcdefghijklmnopqrstuvwxyz01"),
		).rejects.toBeInstanceOf(SecretViolationError);

		expect(provider.embed).not.toHaveBeenCalled();
	});

	it("passes clean text straight through to the provider", async () => {
		const provider = stubProvider();
		const chain = new EmbeddingFallbackChain([provider]);

		const result = await chain.embed("project architecture overview");

		expect(provider.embed).toHaveBeenCalledWith("project architecture overview");
		expect(result.vector).toEqual([0.1, 0.2, 0.3, 0.4]);
		expect(result.provider).toBe("local");
	});
});
