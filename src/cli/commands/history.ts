// B2 · runtime-trust — `memory history <id>` CLI wrapper around
// `buildHistory`. Default: ASCII timeline grouped by day. `--json`:
// history-v1 envelope (schema: tests/fixtures/retrieval/history-v1.schema.json).

import type { Command } from "commander";
import { MemoryEntryRepository } from "../../db/repositories/memory-entry.repository.js";
import { MemoryEventRepository } from "../../db/repositories/memory-event.repository.js";
import { buildHistory, type HistoryEvent, type HistoryV1 } from "../../trust/history.service.js";
import { closeDb, getDb } from "../context.js";

// History pull cap. Matches the B2 perf criterion (1000 events per
// entry in < 100 ms) and guards against runaway entries.
const HISTORY_LIMIT = 1000;

function formatDiff(ev: HistoryEvent): string {
	const parts: string[] = [];
	if (ev.diff.status) {
		parts.push(`status: ${ev.diff.status.before ?? "—"} → ${ev.diff.status.after ?? "—"}`);
	}
	if (ev.diff.score) {
		const b = ev.diff.score.before;
		const a = ev.diff.score.after;
		parts.push(`score: ${b === null ? "—" : b.toFixed(3)} → ${a === null ? "—" : a.toFixed(3)}`);
	}
	return parts.join("  ·  ");
}

function renderHuman(h: HistoryV1): string {
	const lines: string[] = [];
	lines.push(`${h.entry.id}  —  ${h.entry.title}`);
	lines.push(
		`  status=${h.entry.status}  score=${h.entry.current_score.toFixed(3)}  events=${h.range.event_count}${h.range.since ? `  since=${h.range.since}` : ""}`,
	);
	lines.push("");
	if (h.timeline.length === 0) {
		lines.push("(no events in range)");
		return lines.join("\n");
	}
	for (const day of h.timeline) {
		lines.push(`── ${day.day} ──`);
		for (const ev of day.events) {
			const hhmm = ev.occurred_at.slice(11, 16);
			const kind = `[${ev.actor_kind}]`;
			const head = `  ${hhmm}  ${kind.padEnd(9)} ${ev.event_type.padEnd(20)} ${ev.actor}`;
			lines.push(head);
			const diff = formatDiff(ev);
			if (diff) lines.push(`         ${diff}`);
			if (ev.reason) lines.push(`         — ${ev.reason}`);
		}
		lines.push("");
	}
	return lines.join("\n").replace(/\n+$/, "");
}

function parseSince(raw: string | undefined): Date | undefined {
	if (!raw) return undefined;
	const d = new Date(raw);
	if (Number.isNaN(d.getTime())) {
		throw new Error(`--since: not an ISO-8601 timestamp: ${raw}`);
	}
	return d;
}

export function register(program: Command): void {
	program
		.command("history <id>")
		.description("Print the trust-transition timeline for a memory entry (B2 · runtime-trust)")
		.option("--json", "Emit history-v1 JSON envelope instead of human output")
		.option("--since <ts>", "ISO-8601 timestamp — only events at or after this time")
		.action(async (id: string, options: { json?: boolean; since?: string }) => {
			try {
				const since = parseSince(options.since);
				const sql = getDb();
				const eventRepo = new MemoryEventRepository(sql);
				const entryRepo = new MemoryEntryRepository(sql, eventRepo);
				const entry = await entryRepo.findById(id);
				if (!entry) {
					console.error(JSON.stringify({ error: `Entry not found: ${id}` }));
					await closeDb();
					process.exit(1);
					return;
				}
				const events = await eventRepo.listByEntry(id, {
					limit: HISTORY_LIMIT,
					since,
				});
				const history = buildHistory({ entry, events, since: since ?? null });
				if (options.json) console.log(JSON.stringify(history, null, 2));
				else console.log(renderHuman(history));
				await closeDb();
				process.exit(0);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				console.error(JSON.stringify({ error: message }));
				await closeDb();
				process.exit(1);
			}
		});
}
