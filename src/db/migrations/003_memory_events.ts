import type postgres from "postgres";

/**
 * Migration 003 — add the `memory_events` audit table.
 *
 * Shared event log for secret-safety (roadmap IV1) and the later
 * runtime-trust audit log (B4). IV1 ships a minimal column set; B4
 * extends it via a later migration with `before` / `after` / `reason`
 * without re-creating the table.
 *
 * Column contract (IV1):
 *   id           — uuid, generated server-side.
 *   entry_id     — optional FK to memory_entries. Secret-reject events
 *                  have no entry (write never happened) → nullable.
 *                  ON DELETE SET NULL so history outlives archival.
 *   occurred_at  — event timestamp, defaults to now().
 *   actor        — string tag (`agent:mcp`, `agent:cli`,
 *                  `system:legacy_scan`) matching the repo's existing
 *                  `createdBy` convention.
 *   event_type   — namespaced string. Allowed values are enforced at
 *                  the application layer (MemoryEventType union) so
 *                  adding a type in B4 does not need a DDL migration.
 *   metadata     — jsonb bag. For secret events carries pattern name,
 *                  ingress_path, policy, and optional field. NEVER the
 *                  secret value or a hash thereof — hashes enable
 *                  brute-force lookup and are explicitly forbidden by
 *                  the IV1 scope ("Nie der Secret-Inhalt oder ein Hash
 *                  davon").
 *
 * Indices:
 *   (entry_id, occurred_at DESC) — B4's `memory history <id>` lookup.
 *   (event_type, occurred_at DESC) — IV2/diagnose recent-event counts.
 */
export async function up(sql: postgres.Sql): Promise<void> {
	await sql`
    CREATE TABLE IF NOT EXISTS memory_events (
      id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      entry_id    uuid NULL REFERENCES memory_entries(id) ON DELETE SET NULL,
      occurred_at timestamptz NOT NULL DEFAULT now(),
      actor       text NOT NULL,
      event_type  text NOT NULL,
      metadata    jsonb NOT NULL DEFAULT '{}'::jsonb
    )
  `;
	await sql`
    CREATE INDEX IF NOT EXISTS memory_events_entry_ts_idx
      ON memory_events (entry_id, occurred_at DESC)
  `;
	await sql`
    CREATE INDEX IF NOT EXISTS memory_events_type_ts_idx
      ON memory_events (event_type, occurred_at DESC)
  `;
}
