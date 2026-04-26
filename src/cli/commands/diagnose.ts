import type { Command } from "commander";
import { MemoryEventRepository } from "../../db/repositories/memory-event.repository.js";
import { closeDb, getDb } from "../context.js";

export function register(program: Command): void {
	program
		.command("diagnose")
		.description("Identify issues: stale entries, low-trust entries")
		.option("--max-results <n>", "Max entries per category", "10")
		.option("--entry <id>", "Show trust-audit event-count breakdown for a single entry (B4)")
		.action(async (options) => {
			try {
				const sql = getDb();
				const max = Number.parseInt(options.maxResults, 10);

				// B4: operator-oriented event view keyed on a specific entry.
				// `memory history <id>` (B2) will later give the full timeline;
				// this is the cheap "is this entry churning?" summary.
				if (options.entry) {
					const eventRepo = new MemoryEventRepository(sql);
					const counts = await eventRepo.countByEntry(options.entry);
					const total = counts.reduce((acc, c) => acc + c.count, 0);
					console.log(JSON.stringify({ entryId: options.entry, total, counts }, null, 2));
					await closeDb();
					process.exit(0);
					return;
				}

				const staleEntries = await sql`
					SELECT id, title, impact_level FROM memory_entries
					WHERE trust_status = 'stale' LIMIT ${max}
				`;
				const lowTrustEntries = await sql`
					SELECT id, title, trust_score FROM memory_entries
					WHERE trust_status = 'validated' AND trust_score < 0.4 LIMIT ${max}
				`;
				console.log(JSON.stringify({ staleEntries, lowTrustEntries }, null, 2));
				await closeDb();
				process.exit(0);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				console.error(JSON.stringify({ error: message }, null, 2));
				await closeDb();
				process.exit(1);
			}
		});
}
