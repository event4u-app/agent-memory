import type postgres from "postgres";
import type { MemoryEntryRepository } from "../db/repositories/memory-entry.repository.js";
import { canPoison } from "./transitions.js";
import { logger } from "../utils/logger.js";

export interface PoisonResult {
  /** The entry that was poisoned */
  poisonedEntryId: string;
  /** Entries flagged for cascade review (transitioned to stale) */
  cascadedEntryIds: string[];
  /** Total number of affected entries */
  totalAffected: number;
}

/**
 * Handles the "poisoned" status — when an entry is confirmed to have caused wrong code.
 *
 * Poisoning triggers a cascade review:
 * 1. The entry is marked as poisoned
 * 2. All entries that share scope overlap (same files, symbols, modules) are flagged as stale
 * 3. An audit trail is created for the entire cascade
 */
export class PoisonService {
  constructor(
    private readonly sql: postgres.Sql,
    private readonly entryRepo: MemoryEntryRepository,
  ) {}

  /**
   * Mark an entry as poisoned and cascade-review all dependent entries.
   */
  async poison(entryId: string, reason: string, triggeredBy = "human"): Promise<PoisonResult> {
    const entry = await this.entryRepo.findById(entryId);
    if (!entry) throw new Error(`Entry not found: ${entryId}`);
    if (!canPoison(entry.trust.status)) {
      throw new Error(`Cannot poison entry in status: ${entry.trust.status}`);
    }

    // Transition to poisoned
    await this.entryRepo.transitionStatus(
      entryId,
      "poisoned",
      `Poisoned: ${reason}`,
      triggeredBy,
    );

    // Find all entries that share scope overlap with the poisoned entry
    const dependentRows = await this.sql`
      SELECT DISTINCT me.id, me.trust_status
      FROM memory_entries me
      WHERE me.id != ${entryId}
        AND me.trust_status IN ('validated', 'stale')
        AND me.scope->>'repository' = ${entry.scope.repository}
        AND (
          ${entry.scope.files.length > 0
            ? this.sql`me.scope->'files' ?| ${entry.scope.files}`
            : this.sql`false`}
          OR ${entry.scope.symbols.length > 0
            ? this.sql`me.scope->'symbols' ?| ${entry.scope.symbols}`
            : this.sql`false`}
          OR ${entry.scope.modules.length > 0
            ? this.sql`me.scope->'modules' ?| ${entry.scope.modules}`
            : this.sql`false`}
        )
    `;

    const cascadedIds: string[] = [];

    for (const row of dependentRows) {
      // Transition validated entries to stale for review
      if (row.trust_status === "validated") {
        await this.entryRepo.transitionStatus(
          row.id,
          "stale",
          `Cascade review: dependent on poisoned entry ${entryId}`,
          "system:poison-cascade",
        );
        cascadedIds.push(row.id);
      } else if (row.trust_status === "stale") {
        // Already stale — just record the cascade in audit log
        await this.sql`
          INSERT INTO memory_status_history (memory_entry_id, from_status, to_status, reason, triggered_by)
          VALUES (${row.id}, 'stale', 'stale', ${`Cascade review: related to poisoned entry ${entryId}`}, 'system:poison-cascade')
        `;
        cascadedIds.push(row.id);
      }
    }

    logger.warn(
      { entryId, cascadedCount: cascadedIds.length, reason },
      "Entry poisoned, cascade review triggered",
    );

    return {
      poisonedEntryId: entryId,
      cascadedEntryIds: cascadedIds,
      totalAffected: cascadedIds.length + 1,
    };
  }

  /**
   * List all entries that were affected by a poison cascade for a given entry.
   */
  async getCascadeHistory(poisonedEntryId: string): Promise<string[]> {
    const rows = await this.sql`
      SELECT DISTINCT memory_entry_id
      FROM memory_status_history
      WHERE triggered_by = 'system:poison-cascade'
        AND reason LIKE ${`%${poisonedEntryId}%`}
      ORDER BY created_at DESC
    `;
    return rows.map((r) => r.memory_entry_id);
  }
}
