import { env } from "node:process";
import {
	loadProjectConfig,
	type ProjectConfig,
	ProjectConfigError,
} from "./config/project-config.js";
import { resolveSecretPolicy } from "./security/secret-policy.js";
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

function clamp(n: number, min: number, max: number): number {
	return Math.max(min, Math.min(max, n));
}

// Load `.agent-memory.yml` at module init. Errors are captured (not thrown)
// so that test environments and libraries that import `config` directly do
// not crash. The CLI entrypoint calls `assertProjectConfigOk()` before any
// command runs, which turns the captured error into a clean exit 1.
let projectConfigResult: { config: ProjectConfig | null; path: string | null; error: Error | null };
try {
	const r = loadProjectConfig();
	projectConfigResult = { config: r.config, path: r.path, error: null };
} catch (err) {
	projectConfigResult = {
		config: null,
		path: err instanceof ProjectConfigError ? err.filePath : null,
		error: err as Error,
	};
}

const yaml = projectConfigResult.config;

/** Surface the YAML load outcome to the CLI / doctor. */
export function getProjectConfigStatus(): {
	path: string | null;
	loaded: boolean;
	error: Error | null;
} {
	return {
		path: projectConfigResult.path,
		loaded: projectConfigResult.config != null,
		error: projectConfigResult.error,
	};
}

/**
 * Called by the CLI entrypoint before any command runs. Turns a captured
 * YAML/schema error into `exit 1` with a clear message (C1-Done #2:
 * „Fehlerhafte YAML → klare Fehlermeldung, exit 1, nicht silent-fallback").
 */
export function assertProjectConfigOk(): void {
	if (projectConfigResult.error) {
		const e = projectConfigResult.error;
		process.stderr.write(`agent-memory: ${e.message}\n`);
		process.exit(1);
	}
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

// YAML-layer resolvers: fall back to the YAML value when ENV is absent,
// then to the built-in default. Clamped to the same legal range.
const yamlProvider = yaml?.embedding?.provider;
const yamlThreshold = yaml?.trust?.threshold;
const yamlThresholdLow = yaml?.trust?.threshold_low;
const yamlTokenBudget = yaml?.retrieval?.token_budget;
const yamlRepository = yaml?.repository;

export const config = {
	database: {
		url: env.DATABASE_URL ?? "postgresql://memory:memory_dev@localhost:5433/agent_memory",
		urlTest:
			env.DATABASE_URL_TEST ?? "postgresql://memory:memory_dev@localhost:5434/agent_memory_test",
	},
	embedding: {
		provider: (env.EMBEDDING_PROVIDER ?? yamlProvider ?? "bm25-only") as
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
		thresholdDefault: parseFloatSafe(
			env.MEMORY_TRUST_THRESHOLD_DEFAULT,
			yamlThreshold !== undefined ? clamp(yamlThreshold, 0, 1) : 0.6,
			0,
			1,
		),
		/** Lower threshold for low-trust mode (0.0–1.0) */
		thresholdLow: parseFloatSafe(
			env.MEMORY_TRUST_THRESHOLD_LOW,
			yamlThresholdLow !== undefined ? clamp(yamlThresholdLow, 0, 1) : 0.3,
			0,
			1,
		),
	},
	/** Repository identifier (YAML-only; no ENV equivalent, ties to C2/C3). */
	repository: yamlRepository ?? null,
	/** Max tokens for progressive disclosure (100–50000) */
	tokenBudget: parseIntSafe(
		env.MEMORY_TOKEN_BUDGET,
		yamlTokenBudget !== undefined ? clamp(yamlTokenBudget, 100, 50000) : 2000,
		100,
		50000,
	),
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
	security: {
		/** Ingress secret policy — reject (default) or redact. See MEMORY_SECRET_POLICY. */
		secretPolicy: resolveSecretPolicy(env.MEMORY_SECRET_POLICY),
		/**
		 * Shannon-entropy threshold for the quoted-string heuristic (bits per char).
		 * Strings at or below this value pass; strings above are flagged as
		 * `HIGH_ENTROPY_DETECTED`. Default 4.5 is calibrated against the corpus
		 * in `tests/fixtures/entropy-corpus/` — see
		 * `docs/security/entropy-calibration.md` for the precision/recall
		 * matrix and the reasoning that picked this dial.
		 */
		entropyThreshold: parseFloatSafe(env.MEMORY_ENTROPY_THRESHOLD, 4.5, 0, 8),
		/**
		 * Minimum length (chars) of the quoted inner content before the entropy
		 * heuristic fires. Shorter strings are ignored regardless of entropy.
		 */
		entropyMinLength: parseIntSafe(env.MEMORY_ENTROPY_MIN_LENGTH, 20, 1, 1024),
	},
	/**
	 * Raw `policies:` block from `.agent-memory.yml` (C1). Consumed by
	 * `memory policy check` (C2). Empty object when no YAML is present.
	 */
	policies: (yaml?.policies ?? {}) as NonNullable<ProjectConfig["policies"]>,
} as const;
