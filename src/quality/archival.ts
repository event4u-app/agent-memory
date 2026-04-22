import type postgres from "postgres";
import type { MemoryEntryRepository } from "../db/repositories/memory-entry.repository.js";
import { logger } from "../utils/logger.js";

export interface ArchivalResult {
	/** Entries archived */
	archivedCount: number;
	/** Entry IDs that were archived */
	archivedIds: string[];
}

/** Default: archive entries that have been invalidated/rejected for 30+ days */
const DEFAULT_AGE_DAYS = 30;

/**
 * Archive invalidated/rejected entries that have been in that state for a configurable period.
 * Archived entries are excluded from all retrieval and invalidation logic.
 *
 * Should be run periodically (weekly is fine).
 */
export async function runArchival(
	sql: postgres.Sql,
	entryRepo: MemoryEntryRepository,
	ageDays = DEFAULT_AGE_DAYS,
): Promise<ArchivalResult> {
	// Find entries eligible for archival:
	// - Status: invalidated, rejected, or poisoned
	// - Last status change was more than ageDays ago
	const rows = await sql`
    SELECT me.id
    FROM memory_entries me
    WHERE me.trust_status IN ('invalidated', 'rejected', 'poisoned')
      AND me.updated_at < NOW() - ${`${ageDays} days`}::interval
    LIMIT 100
  `;

	const archivedIds: string[] = [];

	for (const row of rows) {
		try {
			await entryRepo.transitionStatus(
				row.id as string,
				"archived",
				`Auto-archived after ${ageDays} days in terminal state`,
				"system:archival",
			);
			archivedIds.push(row.id as string);
		} catch (err) {
			logger.warn({ entryId: row.id, err }, "Failed to archive entry");
		}
	}

	if (archivedIds.length > 0) {
		logger.info({ count: archivedIds.length, ageDays }, "Archival job complete");
	}

	return {
		archivedCount: archivedIds.length,
		archivedIds,
	};
}

/**
 * Purge archived entries older than a threshold (hard delete).
 * Use with caution — this is irreversible.
 */
export async function purgeArchived(
	sql: postgres.Sql,
	olderThanDays = 90,
): Promise<{ purgedCount: number }> {
	// Delete evidence first (FK constraint)
	await sql`
    DELETE FROM memory_evidence
    WHERE memory_entry_id IN (
      SELECT id FROM memory_entries
      WHERE trust_status = 'archived'
        AND updated_at < NOW() - ${`${olderThanDays} days`}::interval
    )
  `;

	// Delete contradictions
	await sql`
    DELETE FROM memory_contradictions
    WHERE entry_a_id IN (
      SELECT id FROM memory_entries
      WHERE trust_status = 'archived'
        AND updated_at < NOW() - ${`${olderThanDays} days`}::interval
    )
    OR entry_b_id IN (
      SELECT id FROM memory_entries
      WHERE trust_status = 'archived'
        AND updated_at < NOW() - ${`${olderThanDays} days`}::interval
    )
  `;

	// Delete status history
	await sql`
    DELETE FROM memory_status_history
    WHERE memory_entry_id IN (
      SELECT id FROM memory_entries
      WHERE trust_status = 'archived'
        AND updated_at < NOW() - ${`${olderThanDays} days`}::interval
    )
  `;

	// Delete entries
	const result = await sql`
    DELETE FROM memory_entries
    WHERE trust_status = 'archived'
      AND updated_at < NOW() - ${`${olderThanDays} days`}::interval
  `;

	const purgedCount = result.count;

	if (purgedCount > 0) {
		logger.warn({ purgedCount, olderThanDays }, "Archived entries purged (hard delete)");
	}

	return { purgedCount };
}
