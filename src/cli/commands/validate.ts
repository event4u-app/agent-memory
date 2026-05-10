import type { Command } from "commander";
import { buildQuarantineService, closeDb } from "../context.js";

export function register(program: Command): void {
	program
		.command("validate")
		.description("Run validators against a quarantined entry")
		.argument("<id>", "Memory entry ID")
		.option("--triggered-by <actor>", "Caller identifier", "cli:validate")
		.action(async (id, options) => {
			try {
				const service = buildQuarantineService();
				const result = await service.validateEntry(id, options.triggeredBy);
				console.log(JSON.stringify(result, null, 2));
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
