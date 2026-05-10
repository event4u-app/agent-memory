import type { Command } from "commander";
import { closeDb, HEALTH_TIMEOUT_MS, probeHealth } from "../context.js";

export function register(program: Command): void {
	program
		.command("status")
		.description("Feature detection for consumers — prints present | absent | misconfigured")
		.option("--timeout <ms>", "Timeout in ms", String(HEALTH_TIMEOUT_MS))
		.option("--json", "Emit full JSON envelope (always exits 0)")
		.action(async (options) => {
			const timeoutMs = Number.parseInt(options.timeout, 10) || HEALTH_TIMEOUT_MS;
			const envelope = await probeHealth(timeoutMs);
			const memoryStatus: "present" | "absent" | "misconfigured" =
				envelope.status === "ok" ? "present" : "misconfigured";
			if (options.json) {
				console.log(JSON.stringify({ memory_status: memoryStatus, ...envelope }, null, 2));
			} else {
				console.log(memoryStatus);
			}
			await closeDb();
			process.exit(0);
		});
}
