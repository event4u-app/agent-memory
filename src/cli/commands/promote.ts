import type { Command } from "commander";
import type { MemoryType } from "../../types.js";
import { buildPromotionService, closeDb, collect } from "../context.js";

export function register(program: Command): void {
	program
		.command("promote")
		.description("Promote a quarantined proposal through gate criteria")
		.argument("<proposal-id>", "Proposal ID returned by `propose`")
		.option(
			"--allowed-type <type>",
			"Allowed target type (repeatable; consumer policy)",
			collect,
			[],
		)
		.option(
			"--skip-duplicate-check",
			"Skip non-duplication gate (caller accepts the sibling)",
			false,
		)
		.option("--triggered-by <actor>", "Caller identifier", "cli:promote")
		.action(async (proposalId, options) => {
			try {
				const service = buildPromotionService();
				const result = await service.promote(proposalId, {
					triggeredBy: options.triggeredBy,
					allowedTargetTypes:
						options.allowedType.length > 0 ? (options.allowedType as MemoryType[]) : undefined,
					skipDuplicateCheck: options.skipDuplicateCheck,
				});
				console.log(JSON.stringify(result, null, 2));
				await closeDb();
				process.exit(result.status === "validated" ? 0 : 1);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				console.error(JSON.stringify({ error: message }, null, 2));
				await closeDb();
				process.exit(1);
			}
		});
}
