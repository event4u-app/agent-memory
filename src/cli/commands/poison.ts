import type { Command } from "commander";
import { MemoryEntryRepository } from "../../db/repositories/memory-entry.repository.js";
import { RollbackService } from "../../invalidation/rollback.js";
import { PoisonService } from "../../trust/poison.service.js";
import { closeDb, getDb } from "../context.js";

export function register(program: Command): void {
	program
		.command("poison")
		.description("Mark an entry as poisoned — cascade review + rollback report")
		.argument("<id>", "Memory entry ID")
		.argument("<reason>", "Why this entry is wrong")
		.option("--triggered-by <actor>", "Caller identifier", "cli:poison")
		.action(async (id, reason, options) => {
			try {
				const sql = getDb();
				const entryRepo = new MemoryEntryRepository(sql);
				const poisonService = new PoisonService(sql, entryRepo);
				const rollback = new RollbackService(sql, poisonService);
				const report = await rollback.poisonAndReport(id, reason, options.triggeredBy);
				console.log(JSON.stringify(report, null, 2));
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
