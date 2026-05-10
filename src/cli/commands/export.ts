// D1 · runtime-trust — `memory export` CLI wrapper around runExport().
//
// Streams JSONL lines to stdout (one per Node `process.stdout.write`).
// Any contract drift fails against
// `tests/fixtures/retrieval/export-v1.schema.json`.

import type { Command } from "commander";
import { EvidenceRepository } from "../../db/repositories/evidence.repository.js";
import { MemoryEntryRepository } from "../../db/repositories/memory-entry.repository.js";
import { MemoryEventRepository } from "../../db/repositories/memory-event.repository.js";
import { runExport } from "../../export/export-service.js";
import { closeDb, getDb } from "../context.js";

export function register(program: Command): void {
	program
		.command("export")
		.description("Export memory entries + events + evidence as JSONL (D1 · runtime-trust)")
		.option("--since <iso>", "Only entries with updated_at >= ISO timestamp")
		.option("--repository <id>", "Only entries scoped to this repository")
		.action(async (options: { since?: string; repository?: string }) => {
			try {
				const sql = getDb();
				const eventRepo = new MemoryEventRepository(sql);
				const entryRepo = new MemoryEntryRepository(sql, eventRepo);
				const evidenceRepo = new EvidenceRepository(sql);
				const summary = await runExport(
					{ entryRepo, evidenceRepo, eventRepo },
					(line: string) => {
						process.stdout.write(line);
					},
					{
						since: options.since ?? null,
						repository: options.repository ?? null,
					},
				);
				// Summary to stderr so stdout stays valid JSONL for piping.
				process.stderr.write(`${JSON.stringify(summary)}\n`);
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
