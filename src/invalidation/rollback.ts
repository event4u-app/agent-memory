import type postgres from "postgres";
import type { PoisonService } from "../trust/poison.service.js";
import { logger } from "../utils/logger.js";

export interface AffectedTask {
  taskId: string;
  entryId: string;
  entryTitle: string;
  impactLevel: string;
}

export interface RollbackReport {
  /** The poisoned entry that triggered the rollback */
  poisonedEntryId: string;
  /** Tasks that were influenced by the poisoned entry */
  affectedTasks: AffectedTask[];
  /** Entries affected by the poison cascade */
  cascadedEntryIds: string[];
}

/**
 * Rollback mechanism: track which tasks were influenced by memory entries.
 *
 * When an entry is poisoned, this service:
 * 1. Finds all tasks that used the poisoned entry (via access log)
 * 2. Finds all entries cascaded by the poison
 * 3. Produces a report for the agent/human to review
 *
 * Note: This doesn't undo code changes — it provides awareness.
 * The agent or human decides what action to take.
 */
export class RollbackService {
  constructor(
    private readonly sql: postgres.Sql,
    private readonly poisonService: PoisonService,
  ) {}

  /**
   * Execute poison + generate rollback report.
   */
  async poisonAndReport(
    entryId: string,
    reason: string,
    triggeredBy = "human",
  ): Promise<RollbackReport> {
    // Execute poison cascade
    const poisonResult = await this.poisonService.poison(entryId, reason, triggeredBy);

    // Find tasks that accessed the poisoned entry
    const affectedTasks = await this.findAffectedTasks(entryId);

    // Also find tasks affected by cascaded entries
    for (const cascadedId of poisonResult.cascadedEntryIds) {
      const cascadedTasks = await this.findAffectedTasks(cascadedId);
      affectedTasks.push(...cascadedTasks);
    }

    // Deduplicate by taskId
    const uniqueTasks = Array.from(
      new Map(affectedTasks.map((t) => [t.taskId, t])).values(),
    );

    logger.warn(
      { entryId, affectedTasks: uniqueTasks.length, cascaded: poisonResult.cascadedEntryIds.length },
      "Rollback report generated",
    );

    return {
      poisonedEntryId: entryId,
      affectedTasks: uniqueTasks,
      cascadedEntryIds: poisonResult.cascadedEntryIds,
    };
  }

  /**
   * Find tasks that accessed (were influenced by) a specific entry.
   * Uses the access log stored in memory_status_history + created_in_task.
   */
  private async findAffectedTasks(entryId: string): Promise<AffectedTask[]> {
    // Find tasks via created_in_task of entries that reference this entry
    // and via retrieval access patterns
    const rows = await this.sql`
      SELECT DISTINCT
        me.created_in_task AS task_id,
        me.id AS entry_id,
        me.title AS entry_title,
        me.impact_level
      FROM memory_entries me
      WHERE me.created_in_task IS NOT NULL
        AND me.id = ${entryId}
      UNION
      SELECT DISTINCT
        msh.triggered_by AS task_id,
        me.id AS entry_id,
        me.title AS entry_title,
        me.impact_level
      FROM memory_status_history msh
      JOIN memory_entries me ON me.id = msh.memory_entry_id
      WHERE msh.memory_entry_id = ${entryId}
        AND msh.triggered_by NOT LIKE 'system:%'
      LIMIT 50
    `;

    return rows
      .filter((r) => r.task_id)
      .map((r) => ({
        taskId: r.task_id as string,
        entryId: r.entry_id as string,
        entryTitle: r.entry_title as string,
        impactLevel: r.impact_level as string,
      }));
  }
}
