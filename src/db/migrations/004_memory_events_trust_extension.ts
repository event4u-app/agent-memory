import type postgres from "postgres";

/**
 * Migration 004 — extend `memory_events` with the trust-audit columns
 * promised by migration 003's header comment (B4 · runtime-trust).
 *
 * IV1 (migration 003) shipped a minimal column set sized for secret
 * events. B4 needs structured before/after diffs + a reason string so
 * `memory explain` (B1) and `memory history` (B2) can answer "why did
 * trust_score change between T1 and T2?" without loading the full
 * entry row at every point in time.
 *
 * Design notes:
 *  - All three columns are nullable so existing IV1 rows stay valid
 *    (secret events have no before/after, only metadata).
 *  - `before` / `after` are jsonb so callers can record whatever slice
 *    of the entry matters for the transition — application-layer
 *    contract lives in the event emitters, not the schema.
 *  - `reason` is free-form text capped at 512 chars at the app layer.
 *    No CHECK constraint here — we want to land new event types fast
 *    without schema migrations.
 *  - No backfill: IV1 events have no before/after semantics to
 *    synthesize. Trust-audit reads short-circuit when columns are
 *    NULL, which is the same behaviour as "no data" — exactly right.
 */
export async function up(sql: postgres.Sql): Promise<void> {
	await sql`
    ALTER TABLE memory_events
      ADD COLUMN IF NOT EXISTS before jsonb NULL,
      ADD COLUMN IF NOT EXISTS after jsonb NULL,
      ADD COLUMN IF NOT EXISTS reason text NULL
  `;
}
