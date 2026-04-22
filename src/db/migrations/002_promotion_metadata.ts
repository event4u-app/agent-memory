import type postgres from "postgres";

/**
 * Migration 002 — add `promotion_metadata` JSONB column to `memory_entries`.
 *
 * Carries proposal-time gate inputs (futureScenarios, source,
 * gateCleanAtProposal) from `propose()` to `promote()` so gate criteria
 * defined in `agents/roadmaps/archive/from-agent-config/road-to-promotion-flow.md`
 * can be enforced on promote.
 *
 * Safe: additive column with `NOT NULL DEFAULT '{}'::jsonb`; existing rows
 * backfill automatically.
 */
export async function up(sql: postgres.Sql): Promise<void> {
	await sql`
    ALTER TABLE memory_entries
    ADD COLUMN IF NOT EXISTS promotion_metadata JSONB NOT NULL DEFAULT '{}'::jsonb
  `;
}
