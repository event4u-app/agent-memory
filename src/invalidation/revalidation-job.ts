import type postgres from "postgres";
import type { QuarantineService } from "../trust/quarantine.service.js";
import type { MemoryEntryRepository } from "../db/repositories/memory-entry.repository.js";
import { logger } from "../utils/logger.js";

export interface RevalidationResult {
  /** Total stale entries processed */
  processed: number;
  /** Entries re-validated successfully */
  revalidated: number;
  /** Entries rejected during revalidation */
  rejected: number;
  /** Entries skipped (e.g. errors) */
  skipped: number;
}

/**
 * Revalidation job: re-run validators on stale entries.
 * Prioritizes by impact level (critical first).
 *
 * Flow: stale → quarantine → validators → validated or rejected.
 */
export class RevalidationJob {
  constructor(
    private readonly sql: postgres.Sql,
    private readonly entryRepo: MemoryEntryRepository,
    private readonly quarantineService: QuarantineService,
  ) {}

  async run(maxEntries = 20): Promise<RevalidationResult> {
    // Find stale entries, prioritized by impact level
    const staleRows = await this.sql`
      SELECT id, impact_level
      FROM memory_entries
      WHERE trust_status = 'stale'
      ORDER BY
        CASE impact_level
          WHEN 'critical' THEN 1
          WHEN 'high' THEN 2
          WHEN 'normal' THEN 3
          WHEN 'low' THEN 4
        END ASC,
        updated_at ASC
      LIMIT ${maxEntries}
    `;

    let revalidated = 0;
    let rejected = 0;
    let skipped = 0;

    for (const row of staleRows) {
      try {
        // Transition stale → quarantine for re-validation
        await this.entryRepo.transitionStatus(
          row.id,
          "quarantine",
          "Re-entering quarantine for revalidation",
          "system:revalidation",
        );

        // Run validation
        const result = await this.quarantineService.validateEntry(row.id, "system:revalidation");

        if (result.decision === "validate") {
          revalidated++;
        } else {
          rejected++;
        }
      } catch (err) {
        logger.warn({ entryId: row.id, err }, "Revalidation failed for entry");
        skipped++;
      }
    }

    if (staleRows.length > 0) {
      logger.info(
        { processed: staleRows.length, revalidated, rejected, skipped },
        "Revalidation job complete",
      );
    }

    return {
      processed: staleRows.length,
      revalidated,
      rejected,
      skipped,
    };
  }
}
