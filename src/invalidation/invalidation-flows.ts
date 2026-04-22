import type { MemoryEntryRepository } from "../db/repositories/memory-entry.repository.js";
import { isValidTransition } from "../trust/transitions.js";
import type { TrustStatus } from "../types.js";
import { logger } from "../utils/logger.js";

export interface InvalidationResult {
	entryId: string;
	fromStatus: TrustStatus;
	toStatus: TrustStatus;
	reason: string;
	action: "soft" | "hard" | "skipped";
}

/**
 * Soft invalidation: evidence weakened but not gone.
 * Transitions validated → stale. Entry remains serveable but with lower ranking.
 * Triggers revalidation in next cycle.
 */
export async function softInvalidate(
	entryId: string,
	reason: string,
	entryRepo: MemoryEntryRepository,
	triggeredBy = "system:invalidation",
): Promise<InvalidationResult> {
	const entry = await entryRepo.findById(entryId);
	if (!entry) throw new Error(`Entry not found: ${entryId}`);

	const from = entry.trust.status;

	if (from === "stale" || from === "rejected" || from === "poisoned") {
		return {
			entryId,
			fromStatus: from,
			toStatus: from,
			reason: "Already invalidated",
			action: "skipped",
		};
	}

	if (!isValidTransition(from, "stale")) {
		return {
			entryId,
			fromStatus: from,
			toStatus: from,
			reason: `Cannot stale from ${from}`,
			action: "skipped",
		};
	}

	await entryRepo.transitionStatus(entryId, "stale", `Soft invalidation: ${reason}`, triggeredBy);

	logger.info({ entryId, from, reason }, "Soft invalidation applied");

	return {
		entryId,
		fromStatus: from,
		toStatus: "stale",
		reason,
		action: "soft",
	};
}

/**
 * Hard invalidation: evidence is gone (file deleted, symbol removed).
 * Transitions validated/stale → rejected. Entry is blocked from serving.
 */
export async function hardInvalidate(
	entryId: string,
	reason: string,
	entryRepo: MemoryEntryRepository,
	triggeredBy = "system:invalidation",
): Promise<InvalidationResult> {
	const entry = await entryRepo.findById(entryId);
	if (!entry) throw new Error(`Entry not found: ${entryId}`);

	const from = entry.trust.status;

	if (from === "invalidated" || from === "rejected" || from === "poisoned") {
		return {
			entryId,
			fromStatus: from,
			toStatus: from,
			reason: "Already invalidated/rejected/poisoned",
			action: "skipped",
		};
	}

	if (!isValidTransition(from, "invalidated")) {
		return {
			entryId,
			fromStatus: from,
			toStatus: from,
			reason: `Cannot invalidate from ${from}`,
			action: "skipped",
		};
	}

	await entryRepo.transitionStatus(
		entryId,
		"invalidated",
		`Hard invalidation: ${reason}`,
		triggeredBy,
	);

	logger.warn({ entryId, from, reason }, "Hard invalidation applied");

	return {
		entryId,
		fromStatus: from,
		toStatus: "invalidated",
		reason,
		action: "hard",
	};
}
