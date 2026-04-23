import type { Command } from "commander";
import { MemoryEntryRepository } from "../../db/repositories/memory-entry.repository.js";
import { RollbackService } from "../../invalidation/rollback.js";
import { PoisonService } from "../../trust/poison.service.js";
import { closeDb, getDb } from "../context.js";

export function register(program: Command): void {
	program
		.command("rollback")
		.description("Roll back a poisoned entry — report affected tasks + cascaded entries")
		.argument("<id>", "Memory entry ID to roll back")
		.option("--reason <text>", "Why this entry is being rolled back", "Rolled back via CLI")
		.option("--triggered-by <actor>", "Caller identifier", "cli:rollback")
		.action(async (id, options) => {
			try {
				const sql = getDb();
				const entryRepo = new MemoryEntryRepository(sql);
				const poisonService = new PoisonService(sql, entryRepo);
				const rollback = new RollbackService(sql, poisonService);
				const report = await rollback.poisonAndReport(id, options.reason, options.triggeredBy);
				const output = {
					rolledBackEntryId: report.poisonedEntryId,
					cascadedEntryIds: report.cascadedEntryIds,
					affectedTasks: report.affectedTasks,
					summary: {
						cascadedCount: report.cascadedEntryIds.length,
						taskCount: report.affectedTasks.length,
					},
				};
				console.log(JSON.stringify(output, null, 2));
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
