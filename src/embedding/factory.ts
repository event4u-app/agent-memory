/**
 * Builds an EmbeddingFallbackChain from config.
 *
 * Auto-detection rules:
 *   - provider=bm25-only → chain contains only Bm25OnlyProvider (vector search off)
 *   - provider=gemini|openai|voyage but no API key → falls back to bm25-only + warn
 *   - provider=local → reserved for future on-device model; currently → bm25-only
 *
 * The chain always ends with Bm25OnlyProvider so callers never get an error —
 * a missing embedding just means vector search is skipped, BM25 still works.
 */

import { config } from "../config.js";
import { logger } from "../utils/logger.js";
import { Bm25OnlyProvider } from "./bm25-only.provider.js";
import { EmbeddingFallbackChain } from "./fallback-chain.js";
import type { EmbeddingProvider } from "./types.js";

export function buildEmbeddingChain(): EmbeddingFallbackChain {
	const providers = detectProviders();
	return new EmbeddingFallbackChain(providers);
}

function detectProviders(): EmbeddingProvider[] {
	const configured = config.embedding.provider;
	const terminal = new Bm25OnlyProvider();

	if (configured === "bm25-only") {
		return [terminal];
	}

	const apiKey = resolveApiKey(configured);
	if (!apiKey && configured !== "local") {
		logger.warn(
			{ provider: configured },
			"Embedding provider configured but API key missing — falling back to bm25-only",
		);
		return [terminal];
	}

	// Real providers are not bundled to keep this package dependency-free.
	// When activating, add e.g. new GeminiProvider(apiKey) here as the head of the chain.
	logger.info(
		{ provider: configured },
		"Embedding provider not implemented in this build — chain resolves to bm25-only",
	);
	return [terminal];
}

function resolveApiKey(provider: string): string | undefined {
	switch (provider) {
		case "gemini":
			return config.embedding.geminiApiKey;
		case "openai":
			return config.embedding.openaiApiKey;
		case "voyage":
			return config.embedding.voyageApiKey;
		default:
			return undefined;
	}
}
