/**
 * Decay calibration per content type.
 *
 * Implements the policy from
 * `agents/roadmaps/from-agent-config/road-to-decay-calibration.md`:
 *
 * - Each consolidation tier has a default half-life and floor.
 * - Content types can override tier defaults (e.g. ADRs → no decay).
 * - `halfLifeDays: null` = skip decay arithmetic entirely.
 * - Consumers tune via `.agent-project-settings.memory.decay` (written into
 *   the runtime config at install time).
 */

import type { ConsolidationTier, MemoryType } from "../types.js";

export interface DecayRule {
	/** Half-life in days. `null` = no decay. */
	halfLifeDays: number | null;
	/** Minimum trust score — decay floor, does not override serve threshold. */
	floor: number;
}

export interface DecayConfig {
	tierDefaults: Record<ConsolidationTier, DecayRule>;
	/** Per-type overrides keyed by MemoryType or a content-type slug. */
	typeOverrides: Record<string, Partial<DecayRule>>;
}

/** Defaults derived from the decay-calibration spec. */
export const DEFAULT_DECAY_CONFIG: DecayConfig = {
	tierDefaults: {
		working: { halfLifeDays: 2 / 24, floor: 0 }, // 2 hours
		episodic: { halfLifeDays: 30, floor: 0.4 },
		semantic: { halfLifeDays: 180, floor: 0.3 },
		procedural: { halfLifeDays: 720, floor: 0.8 },
	},
	typeOverrides: {
		// Recommended overrides from the spec (content-type slug form).
		"domain-invariant": { halfLifeDays: 365 },
		ownership: { halfLifeDays: 365 },
		"historical-pattern": { halfLifeDays: 180, floor: 0.5 },
		"incident-learning": { halfLifeDays: 90 },
		adr: { halfLifeDays: null },
		"product-rule": { halfLifeDays: 365 },
		// Aliases for internal MemoryType values.
		architecture_decision: { halfLifeDays: null },
		domain_rule: { halfLifeDays: 365 },
		bug_pattern: { halfLifeDays: 180, floor: 0.5 },
	},
};

/** Resolve the effective decay rule for a (tier, type) pair. */
export function resolveDecayRule(
	tier: ConsolidationTier,
	type: MemoryType | string,
	config: DecayConfig = DEFAULT_DECAY_CONFIG,
): DecayRule {
	const tierRule = config.tierDefaults[tier];
	const override = config.typeOverrides[type];
	if (!override) return tierRule;
	return {
		halfLifeDays:
			override.halfLifeDays !== undefined ? override.halfLifeDays : tierRule.halfLifeDays,
		floor: override.floor ?? tierRule.floor,
	};
}

/**
 * Apply decay to a trust score based on age in days since last validation.
 *
 * Uses exponential decay: score(t) = score(0) * 0.5^(t / halfLife).
 * Result is clamped to the resolved floor.
 *
 * `halfLifeDays === null` returns the original score unchanged.
 */
export function applyDecay(
	baseScore: number,
	daysSinceValidation: number,
	rule: DecayRule,
): number {
	if (rule.halfLifeDays === null) return baseScore;
	if (daysSinceValidation <= 0) return baseScore;
	const decayed = baseScore * 0.5 ** (daysSinceValidation / rule.halfLifeDays);
	return Math.max(rule.floor, Math.min(1, decayed));
}

/**
 * Retrieval-hit refresh policy: a successful retrieval counts as validation,
 * but only once per entry per REFRESH_COOLDOWN_DAYS.
 */
export const REFRESH_COOLDOWN_DAYS = 7;

export function shouldRefreshOnHit(lastValidated: Date, now: Date = new Date()): boolean {
	const days = (now.getTime() - lastValidated.getTime()) / (1000 * 60 * 60 * 24);
	return days >= REFRESH_COOLDOWN_DAYS;
}

/**
 * Merge consumer-provided overrides (from `.agent-project-settings`) with defaults.
 * Unknown tiers are ignored; unknown type slugs are kept (consumer-defined types).
 */
export function mergeDecayConfig(
	overrides: Partial<DecayConfig> | undefined,
	base: DecayConfig = DEFAULT_DECAY_CONFIG,
): DecayConfig {
	if (!overrides) return base;
	const tierDefaults = { ...base.tierDefaults };
	if (overrides.tierDefaults) {
		for (const [tier, rule] of Object.entries(overrides.tierDefaults)) {
			if (tier in tierDefaults) {
				tierDefaults[tier as ConsolidationTier] = {
					...tierDefaults[tier as ConsolidationTier],
					...rule,
				};
			}
		}
	}
	return {
		tierDefaults,
		typeOverrides: {
			...base.typeOverrides,
			...(overrides.typeOverrides ?? {}),
		},
	};
}
