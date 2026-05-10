import type { Command } from "commander";
import { MemoryEntryRepository } from "../../db/repositories/memory-entry.repository.js";
import type { ImpactLevel, KnowledgeClass, MemoryType } from "../../types.js";
import { closeDb, collect, getDb } from "../context.js";

export function register(program: Command): void {
	program
		.command("ingest")
		.description("Create a memory entry in quarantine (one-shot; parity with mcp.memory_ingest)")
		.requiredOption("--type <type>", "Memory type (e.g., architecture_decision)")
		.requiredOption("--title <title>", "Short title")
		.requiredOption("--summary <summary>", "One-paragraph summary")
		.option("--details <details>", "Optional long-form details")
		.requiredOption("--repository <repository>", "Repository identifier")
		.option("--file <path>", "File in scope (repeatable)", collect, [])
		.option("--symbol <symbol>", "Symbol in scope (repeatable)", collect, [])
		.option("--module <module>", "Module in scope (repeatable)", collect, [])
		.option("--impact <level>", "Impact level (critical|high|normal|low)", "normal")
		.option(
			"--knowledge-class <class>",
			"Knowledge class (evergreen|semi_stable|volatile)",
			"semi_stable",
		)
		.option("--created-by <actor>", "Caller identifier", "cli:ingest")
		.action(async (options) => {
			try {
				const sql = getDb();
				const entryRepo = new MemoryEntryRepository(sql);
				const entry = await entryRepo.create({
					type: options.type as MemoryType,
					title: options.title,
					summary: options.summary,
					details: options.details,
					scope: {
						repository: options.repository,
						files: options.file,
						symbols: options.symbol,
						modules: options.module,
					},
					impactLevel: options.impact as ImpactLevel,
					knowledgeClass: options.knowledgeClass as KnowledgeClass,
					embeddingText: `${options.title}\n${options.summary}`,
					createdBy: options.createdBy,
				});
				console.log(
					JSON.stringify(
						{
							id: entry.id,
							status: "quarantine",
							message: "Entry created. Needs validation.",
						},
						null,
						2,
					),
				);
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
