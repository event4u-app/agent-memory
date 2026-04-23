import type { Command } from "commander";

export function register(program: Command): void {
	program
		.command("doctor")
		.description("Diagnose environment: DATABASE_URL, pgvector, migrations, agent-config")
		.option("--json", "Emit JSON only (no human summary on stderr)", false)
		.option("--fix", "Auto-repair pgvector + pending migrations, then re-diagnose", false)
		.action(async (options) => {
			const { runDoctor, renderHuman } = await import("../doctor.js");
			try {
				const report = await runDoctor({ fix: options.fix === true });
				// Human summary → stderr (always, unless --json); JSON → stdout.
				if (!options.json) {
					process.stderr.write(`${renderHuman(report)}\n`);
				}
				console.log(JSON.stringify(report, null, 2));
				process.exit(report.status === "unhealthy" ? 1 : 0);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				console.error(JSON.stringify({ error: message }, null, 2));
				process.exit(1);
			}
		});
}
