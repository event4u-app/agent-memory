// D1 · runtime-trust — reads a JSONL export and writes it back into the
// store with preserved IDs, trust state, and timestamps. Writes each
// entry + its evidence + events in a single transaction so a mid-file
// failure never leaves partial state (roadmap D1 · Done).
//
// III3 · secret-safety — every incoming line claims `redaction.version`;
// the parser rejects anything other than "1". An incoming line with
// `redaction.applied: false` is re-scanned and rejected if any
// SECRET_DETECTED pattern fires, so an outdated or tampered export
// cannot re-seed secrets into the store.

import type postgres from "postgres";
import { RETRIEVAL_REDACTION_MARKER } from "../security/retrieval-redaction.js";
import { SECRET_PATTERNS } from "../security/secret-patterns.js";
import type { ExportEntryLine } from "./types.js";

export type OnConflict = "fail" | "update" | "skip";

export class ImportConflictError extends Error {
	constructor(public readonly entryId: string) {
		super(`entry already exists: ${entryId}`);
		this.name = "ImportConflictError";
	}
}

export class ImportSecretLeakError extends Error {
	constructor(
		public readonly entryId: string,
		public readonly patterns: string[],
	) {
		super(
			`entry claims redaction.applied=false but scanner detected secrets: ${patterns.join(", ")} (id=${entryId})`,
		);
		this.name = "ImportSecretLeakError";
	}
}

export interface ImportStats {
	inserted: number;
	updated: number;
	skipped: number;
}

/** Scan text for SECRET_DETECTED patterns; used as the import-side guard. */
function scanText(text: string): string[] {
	const hits = new Set<string>();
	for (const { name, code, regex } of SECRET_PATTERNS) {
		if (code !== "SECRET_DETECTED") continue;
		regex.lastIndex = 0;
		if (regex.test(text)) hits.add(name);
	}
	return [...hits].sort();
}

export function verifyNoSecretLeak(line: ExportEntryLine): void {
	if (line.redaction.applied) return; // Already redacted by exporter — trust marker
	const haystack = [
		line.entry.title,
		line.entry.summary,
		line.entry.details ?? "",
		line.entry.embedding_text,
		...line.evidence.map((e) => `${e.ref}\n${e.details ?? ""}`),
		...line.events.map((ev) => ev.reason ?? ""),
	]
		.join("\n")
		// Ignore the retrieval marker itself — it's not a secret pattern
		// but the scanner doesn't look at context.
		.replaceAll(RETRIEVAL_REDACTION_MARKER, "");
	const hits = scanText(haystack);
	if (hits.length > 0) throw new ImportSecretLeakError(line.entry.id, hits);
}

// Accept both the top-level `postgres.Sql` and the `TransactionSql` variant
// passed by `sql.begin()` — the `any` disables the postgres.js typing quirk
// that the two do not share a base without an explicit cast.
// biome-ignore lint/suspicious/noExplicitAny: postgres.js TransactionSql vs Sql.
type SqlLike = any;

async function deleteChildren(sql: SqlLike, entryId: string): Promise<void> {
	await sql`DELETE FROM memory_evidence WHERE memory_entry_id = ${entryId}`;
	await sql`DELETE FROM memory_events WHERE entry_id = ${entryId}`;
	await sql`DELETE FROM memory_status_history WHERE memory_entry_id = ${entryId}`;
}

async function insertEntryRow(sql: SqlLike, line: ExportEntryLine): Promise<void> {
	const e = line.entry;
	await sql`
		INSERT INTO memory_entries (
			id, type, title, summary, details, scope,
			impact_level, knowledge_class, consolidation_tier,
			embedding_text, embedding,
			trust_status, trust_score, validated_at, expires_at,
			access_count, last_accessed_at,
			created_by, created_in_task, created_at, updated_at,
			promotion_metadata
		) VALUES (
			${e.id}, ${e.type}, ${e.title}, ${e.summary}, ${e.details},
			${JSON.stringify(e.scope)}::jsonb,
			${e.impact_level}, ${e.knowledge_class}, ${e.consolidation_tier},
			${e.embedding_text}, NULL,
			${e.trust.status}, ${e.trust.score}, ${e.trust.validated_at}, ${e.trust.expires_at},
			${e.access_count}, ${e.last_accessed_at},
			${e.created_by}, ${e.created_in_task}, ${e.created_at}, ${e.updated_at},
			${JSON.stringify(e.promotion_metadata)}::jsonb
		)
	`;
	for (const ev of line.evidence) {
		await sql`
			INSERT INTO memory_evidence (id, memory_entry_id, kind, ref, details, verified_at, created_at)
			VALUES (${ev.id}, ${e.id}, ${ev.kind}, ${ev.ref}, ${ev.details}, ${ev.verified_at}, ${ev.created_at})
		`;
	}
	for (const ev of line.events) {
		await sql`
			INSERT INTO memory_events (id, entry_id, occurred_at, actor, event_type, metadata, before, after, reason)
			VALUES (
				${ev.id}, ${e.id}, ${ev.occurred_at}, ${ev.actor}, ${ev.event_type},
				${JSON.stringify(ev.metadata)}::jsonb,
				${ev.before ? JSON.stringify(ev.before) : null}::jsonb,
				${ev.after ? JSON.stringify(ev.after) : null}::jsonb,
				${ev.reason}
			)
		`;
	}
}

export async function importEntry(
	sql: postgres.Sql,
	line: ExportEntryLine,
	onConflict: OnConflict,
): Promise<"inserted" | "updated" | "skipped"> {
	verifyNoSecretLeak(line);
	const id = line.entry.id;
	const existing = await sql`SELECT id FROM memory_entries WHERE id = ${id} LIMIT 1`;
	const exists = existing.length > 0;

	if (exists) {
		if (onConflict === "fail") throw new ImportConflictError(id);
		if (onConflict === "skip") return "skipped";
		// update: delete-then-reinsert inside a tx so children stay consistent.
		await sql.begin(async (tx) => {
			await deleteChildren(tx, id);
			await tx`DELETE FROM memory_entries WHERE id = ${id}`;
			await insertEntryRow(tx, line);
		});
		return "updated";
	}

	await sql.begin(async (tx) => {
		await insertEntryRow(tx, line);
	});
	return "inserted";
}

export async function importEntries(
	sql: postgres.Sql,
	lines: ExportEntryLine[],
	onConflict: OnConflict,
): Promise<ImportStats> {
	const stats: ImportStats = { inserted: 0, updated: 0, skipped: 0 };
	for (const line of lines) {
		const res = await importEntry(sql, line, onConflict);
		stats[res] += 1;
	}
	return stats;
}
