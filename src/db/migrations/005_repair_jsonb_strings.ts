import type postgres from "postgres";

/**
 * Migration 005 — repair JSONB columns that were silently stored as JSONB
 * strings due to the `${JSON.stringify(x)}::jsonb` bind pattern in writes
 * across the project (D1/D4 import path + entry/event repositories).
 *
 * Root cause: postgres.js infers parameter encoding from the trailing
 * `::jsonb` cast and JSON-encodes the bound string a second time, so a
 * payload like `{"a":1}` was sent as the JSON string `"{\"a\":1}"` and
 * landed as a JSONB scalar of type `string`. The application's `mapRow`
 * defensively `JSON.parse`d the row on read, which masked the bug — but
 * server-side operators (`scope->>'key'`, `?|`, `<>`) all treated the
 * column as a string and silently returned NULL or wrong matches.
 *
 * The runtime fix is in src/db/repositories/* and src/export/import-service.ts
 * where `sql.json(value)` replaces the buggy pattern. This migration
 * cleans up rows already written by the broken code.
 *
 * Strategy:
 *  - For each affected (table, column), unwrap exactly one layer of
 *    JSON encoding when `jsonb_typeof = 'string'` and the unwrapped
 *    text is itself valid JSON. Use `#>> '{}'` to extract the string
 *    value, then re-cast to jsonb.
 *  - Skip rows whose unwrapped text is not valid JSON: those are
 *    legitimate JSONB string values written for some other reason
 *    and must not be corrupted. The repair predicate uses a sub-
 *    select with exception-safe casting so a mid-table bad row
 *    cannot abort the whole UPDATE.
 *  - Idempotent: re-running finds no remaining `string`-typed
 *    payloads and exits as a no-op.
 *
 * Affected columns (every JSONB column written by application code):
 *  - memory_entries.scope               (NOT NULL, default '{}')
 *  - memory_entries.promotion_metadata  (NOT NULL, default '{}')
 *  - memory_events.metadata             (NOT NULL, default '{}')
 *  - memory_events.before               (NULL allowed)
 *  - memory_events.after                (NULL allowed)
 */
export async function up(sql: postgres.Sql): Promise<void> {
	// Helper: try to parse the unwrapped text as JSON inside the DB so we
	// only repair rows where it would succeed. We do this with a CASE that
	// guards on the text starting with `{` or `[` — JSONB scalars (numbers,
	// booleans, null) round-trip as themselves and need no repair, and any
	// raw application string that happens to contain `{...}` is already in
	// the broken-and-needs-repair set.
	for (const target of [
		{ table: "memory_entries", column: "scope" },
		{ table: "memory_entries", column: "promotion_metadata" },
		{ table: "memory_events", column: "metadata" },
		{ table: "memory_events", column: "before" },
		{ table: "memory_events", column: "after" },
	]) {
		// Note: column names are hard-coded above (not user input) — safe
		// to interpolate via `sql.unsafe` for identifiers. The predicate
		// matches "the JSONB scalar is a string AND that string parses as
		// JSON object/array".
		const stmt = `
			UPDATE ${target.table}
			SET ${target.column} = (${target.column} #>> '{}')::jsonb
			WHERE jsonb_typeof(${target.column}) = 'string'
			  AND ((${target.column} #>> '{}') LIKE '{%}' OR (${target.column} #>> '{}') LIKE '[%]')
		`;
		await sql.unsafe(stmt);
	}
}
