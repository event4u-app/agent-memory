import type { ConsolidationTier, MemoryEntry } from "../types.js";
import { logger } from "../utils/logger.js";

/**
 * Minimum validation count to promote semantic → procedural.
 * Only entries validated 3+ times are considered "proven patterns".
 */
const PROCEDURAL_MIN_VALIDATIONS = 3;

const TIER_ORDER: readonly ConsolidationTier[] = [
	"working",
	"episodic",
	"semantic",
	"procedural",
] as const;

/** Default TTL multipliers per tier (in days). */
export const TIER_TTL_DAYS: Record<ConsolidationTier, number> = {
	working: 1,
	episodic: 7,
	semantic: 30,
	procedural: 90,
} as const;

export interface PromotionResult {
	entryId: string;
	fromTier: ConsolidationTier;
	toTier: ConsolidationTier;
	reason: string;
}

/** Get the next tier. Returns null if already at procedural. */
export function getNextTier(current: ConsolidationTier): ConsolidationTier | null {
	const idx = TIER_ORDER.indexOf(current);
	if (idx === -1 || idx >= TIER_ORDER.length - 1) return null;
	return TIER_ORDER[idx + 1]!;
}

/** Check if tier A is higher than tier B. */
export function isTierHigherThan(a: ConsolidationTier, b: ConsolidationTier): boolean {
	return TIER_ORDER.indexOf(a) > TIER_ORDER.indexOf(b);
}

/** Working → Episodic: automatic at session end — any validated working entry. */
export function canPromoteWorkingToEpisodic(entry: MemoryEntry): boolean {
	return entry.consolidationTier === "working" && entry.trust.status === "validated";
}

/** Episodic → Semantic: validated episodic entries accessed at least once. */
export function canPromoteEpisodicToSemantic(entry: MemoryEntry): boolean {
	return (
		entry.consolidationTier === "episodic" &&
		entry.trust.status === "validated" &&
		entry.accessCount >= 1
	);
}

/** Semantic → Procedural: only after 3+ successful validations. */
export function canPromoteSemanticToProcedural(
	entry: MemoryEntry,
	validationCount: number,
): boolean {
	return (
		entry.consolidationTier === "semantic" &&
		entry.trust.status === "validated" &&
		validationCount >= PROCEDURAL_MIN_VALIDATIONS
	);
}

/**
 * Evaluate all possible promotions for a list of entries.
 * Returns promotion recommendations — caller executes them.
 */
export function evaluatePromotions(
	entries: MemoryEntry[],
	validationCounts: Map<string, number> = new Map(),
): PromotionResult[] {
	const promotions: PromotionResult[] = [];

	for (const entry of entries) {
		switch (entry.consolidationTier) {
			case "working":
				if (canPromoteWorkingToEpisodic(entry)) {
					promotions.push({
						entryId: entry.id,
						fromTier: "working",
						toTier: "episodic",
						reason: "Validated working memory promoted at session end",
					});
				}
				break;
			case "episodic":
				if (canPromoteEpisodicToSemantic(entry)) {
					promotions.push({
						entryId: entry.id,
						fromTier: "episodic",
						toTier: "semantic",
						reason: `Episodic memory accessed ${entry.accessCount} time(s)`,
					});
				}
				break;
			case "semantic": {
				const count = validationCounts.get(entry.id) ?? 0;
				if (canPromoteSemanticToProcedural(entry, count)) {
					promotions.push({
						entryId: entry.id,
						fromTier: "semantic",
						toTier: "procedural",
						reason: `Semantic memory validated ${count} times`,
					});
				}
				break;
			}
			case "procedural":
				break;
		}
	}

	if (promotions.length > 0) {
		logger.info({ count: promotions.length }, "Tier promotions evaluated");
	}

	return promotions;
}
