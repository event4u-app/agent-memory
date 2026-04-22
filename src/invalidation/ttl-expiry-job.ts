import type postgres from "postgres";
import type { MemoryEntryRepository } from "../db/repositories/memory-entry.repository.js";
import { logger } from "../utils/logger.js";

export interface ExpiryJobResult {
	/** Number of entries staled */
	staledCount: number;
	/** Entries staled, ordered by impact level (critical first) */
	staledEntryIds: string[];
	/** Entries that are close to expiry (warning) */
	warningEntryIds: string[];
}

const WARNING_DAYS_BEFORE_EXPIRY = 7;

/**
 * TTL expiry job: find entries past their expiry date and transition to stale.
 * Prioritizes high-impact entries for notification.
 *
 * Should be run periodically (e.g. daily via cron or on session start).
 */
export class TtlExpiryJob {
	constructor(
		private readonly sql: postgres.Sql,
		private readonly entryRepo: MemoryEntryRepository,
	) {}

	async run(): Promise<ExpiryJobResult> {
		// Find expired entries that are still validated
		const expiredRows = await this.sql`
      SELECT id, impact_level
      FROM memory_entries
      WHERE trust_status = 'validated'
        AND expires_at < NOW()
      ORDER BY
        CASE impact_level
          WHEN 'critical' THEN 1
          WHEN 'high' THEN 2
          WHEN 'normal' THEN 3
          WHEN 'low' THEN 4
        END ASC
      LIMIT 100
    `;

		const staledIds: string[] = [];
		for (const row of expiredRows) {
			try {
				await this.entryRepo.transitionStatus(
					row.id,
					"stale",
					`TTL expired (impact: ${row.impact_level})`,
					"system:ttl-expiry",
				);
				staledIds.push(row.id);
			} catch (err) {
				logger.warn({ entryId: row.id, err }, "Failed to stale expired entry");
			}
		}

		// Find entries approaching expiry (warning)
		const warningRows = await this.sql`
      SELECT id
      FROM memory_entries
      WHERE trust_status = 'validated'
        AND expires_at BETWEEN NOW() AND NOW() + ${`${WARNING_DAYS_BEFORE_EXPIRY} days`}::interval
      ORDER BY expires_at ASC
      LIMIT 50
    `;
		const warningIds = warningRows.map((r) => r.id as string);

		if (staledIds.length > 0 || warningIds.length > 0) {
			logger.info(
				{ staled: staledIds.length, warnings: warningIds.length },
				"TTL expiry job complete",
			);
		}

		return {
			staledCount: staledIds.length,
			staledEntryIds: staledIds,
			warningEntryIds: warningIds,
		};
	}
}
