import { env } from "node:process";
import { DEFAULT_DECAY_CONFIG, type DecayConfig, mergeDecayConfig } from "./trust/decay.js";

function parseIntSafe(
	value: string | undefined,
	fallback: number,
	min = 0,
	max = Infinity,
): number {
	if (!value) return fallback;
	const n = parseInt(value, 10);
	if (Number.isNaN(n)) return fallback;
	return Math.max(min, Math.min(max, n));
}

function parseFloatSafe(value: string | undefined, fallback: number, min = 0, max = 1): number {
	if (!value) return fallback;
	const n = parseFloat(value);
	if (Number.isNaN(n)) return fallback;
	return Math.max(min, Math.min(max, n));
}

/**
 * Parse decay overrides from `MEMORY_DECAY_OVERRIDES` JSON env var.
 * Invalid JSON falls back to defaults and logs via stderr at startup.
 */
function parseDecayOverrides(value: string | undefined): DecayConfig {
	if (!value) return DEFAULT_DECAY_CONFIG;
	try {
		const parsed = JSON.parse(value) as Partial<DecayConfig>;
		return mergeDecayConfig(parsed);
	} catch {
		return DEFAULT_DECAY_CONFIG;
	}
}

export const config = {
	database: {
		url: env.DATABASE_URL ?? "postgresql://memory:memory_dev@localhost:5433/agent_memory",
		urlTest:
			env.DATABASE_URL_TEST ?? "postgresql://memory:memory_dev@localhost:5434/agent_memory_test",
	},
	embedding: {
		provider: (env.EMBEDDING_PROVIDER ?? "bm25-only") as
			| "local"
			| "gemini"
			| "openai"
			| "voyage"
			| "bm25-only",
		geminiApiKey: env.GEMINI_API_KEY,
		openaiApiKey: env.OPENAI_API_KEY,
		voyageApiKey: env.VOYAGE_API_KEY,
	},
	trust: {
		/** Minimum trust score for retrieval (0.0–1.0) */
		thresholdDefault: parseFloatSafe(env.MEMORY_TRUST_THRESHOLD_DEFAULT, 0.6, 0, 1),
		/** Lower threshold for low-trust mode (0.0–1.0) */
		thresholdLow: parseFloatSafe(env.MEMORY_TRUST_THRESHOLD_LOW, 0.3, 0, 1),
	},
	/** Max tokens for progressive disclosure (100–50000) */
	tokenBudget: parseIntSafe(env.MEMORY_TOKEN_BUDGET, 2000, 100, 50000),
	mcp: {
		port: parseIntSafe(env.MCP_PORT, 3100, 1024, 65535),
	},
	/** Archival: days before auto-archiving invalidated entries */
	archivalAgeDays: parseIntSafe(env.MEMORY_ARCHIVAL_AGE_DAYS, 30, 1, 365),
	/** Purge: days before hard-deleting archived entries */
	purgeAgeDays: parseIntSafe(env.MEMORY_PURGE_AGE_DAYS, 90, 7, 730),
	/** Max entries per invalidation run */
	maxInvalidationBatch: parseIntSafe(env.MEMORY_MAX_INVALIDATION_BATCH, 500, 10, 5000),
	/** Max entries per revalidation run */
	maxRevalidationBatch: parseIntSafe(env.MEMORY_MAX_REVALIDATION_BATCH, 20, 1, 100),
	/** Decay calibration: tier defaults + per-type overrides (see trust/decay.ts) */
	decay: parseDecayOverrides(env.MEMORY_DECAY_OVERRIDES),
	log: {
		level: env.LOG_LEVEL ?? "info",
		format: (env.LOG_FORMAT ?? "json") as "json" | "pretty",
	},
} as const;
