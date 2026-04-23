import type { Command } from "commander";

export function register(program: Command): void {
	program
		.command("mcp")
		.description("Start the MCP stdio server (for agent clients)")
		.action(async () => {
			// Logs go to stderr; the MCP handshake owns stdout.
			process.env.LOG_LEVEL = process.env.LOG_LEVEL ?? "info";
			const { startMcpServer } = await import("../../mcp/server.js");
			try {
				await startMcpServer();
			} catch (err) {
				console.error("Fatal error:", err);
				process.exit(1);
			}
		});
}
