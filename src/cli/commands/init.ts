import type { Command } from "commander";

export function register(program: Command): void {
	program
		.command("init")
		.description(
			"Bootstrap a consumer project: docker-compose.agent-memory.yml, .env.agent-memory, .gitignore marker",
		)
		.option("--yes", "Non-interactive mode (assume yes to prompts)", false)
		.option("--force", "Overwrite existing files instead of skipping", false)
		.action(async (options) => {
			try {
				const { runInit, renderInitSummary } = await import("../init.js");
				const report = await runInit({ force: options.force === true });
				// Human summary → stderr; JSON report → stdout (machine-friendly).
				process.stderr.write(`${renderInitSummary(report)}\n`);
				console.log(JSON.stringify(report, null, 2));
				process.exit(0);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				console.error(JSON.stringify({ status: "error", error: message }, null, 2));
				process.exit(1);
			}
		});
}
