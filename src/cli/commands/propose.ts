import type { Command } from "commander";
import { SecretViolationError } from "../../security/secret-guard.js";
import { SECRET_VIOLATION_EXIT_CODE } from "../../security/secret-violation.js";
import type { ImpactLevel, KnowledgeClass, MemoryType } from "../../types.js";
import { buildPromotionService, closeDb, collect } from "../context.js";

export function register(program: Command): void {
	program
		.command("propose")
		.description("Propose a new memory entry (lands in quarantine; not served until promoted)")
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
		.requiredOption("--source <source>", "Source ref (incident id, PR, ADR)")
		.requiredOption("--confidence <n>", "Initial confidence 0.0–1.0", "0.6")
		.option(
			"--scenario <text>",
			"Future scenario (repeat 3+ times for non-low impact)",
			collect,
			[],
		)
		.option("--gate-clean", "Assert extraction-guard was clean at proposal time", false)
		.option(
			"--gate-not-clean",
			"Mark extraction-guard as failing (will cause rejection on promote)",
			false,
		)
		.option("--created-by <actor>", "Caller identifier", "cli:propose")
		.action(async (options) => {
			try {
				const service = buildPromotionService();
				const gateCleanAtProposal = options.gateNotClean
					? false
					: options.gateClean
						? true
						: undefined;
				const result = await service.propose({
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
					source: options.source,
					confidence: Number.parseFloat(options.confidence),
					futureScenarios: options.scenario.length > 0 ? options.scenario : undefined,
					gateCleanAtProposal,
					actor: "user:cli",
					ingressPath: "cli_propose",
				});
				console.log(JSON.stringify(result, null, 2));
				await closeDb();
				process.exit(0);
			} catch (error) {
				if (error instanceof SecretViolationError) {
					console.error(JSON.stringify(error.violation, null, 2));
					await closeDb();
					process.exit(SECRET_VIOLATION_EXIT_CODE);
				}
				const message = error instanceof Error ? error.message : String(error);
				console.error(JSON.stringify({ error: message }, null, 2));
				await closeDb();
				process.exit(1);
			}
		});
}
