import type { Command } from "commander";
import { closeDb, HEALTH_TIMEOUT_MS, probeHealth } from "../context.js";

export function register(program: Command): void {
	program
		.command("health")
		.description("Probe backend health — returns contract v1 envelope as JSON")
		.option("--timeout <ms>", "Timeout in ms", String(HEALTH_TIMEOUT_MS))
		.action(async (options) => {
			const timeoutMs = Number.parseInt(options.timeout, 10) || HEALTH_TIMEOUT_MS;
			const envelope = await probeHealth(timeoutMs);
			console.log(JSON.stringify(envelope, null, 2));
			await closeDb();
			process.exit(envelope.status === "ok" ? 0 : 1);
		});
}
