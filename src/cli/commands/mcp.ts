import type { Command } from "commander";

function parsePort(raw: string | undefined, fallback: number): number {
	if (!raw) return fallback;
	const n = Number.parseInt(raw, 10);
	if (!Number.isFinite(n) || n < 1 || n > 65535) {
		throw new Error(`invalid --port: ${raw} (expected 1..65535)`);
	}
	return n;
}

export function register(program: Command): void {
	program
		.command("mcp")
		.description("Start the MCP server (stdio by default; --transport sse exposes HTTP/SSE)")
		.option(
			"--transport <kind>",
			"Transport: stdio (default) | sse (HTTP listener with bearer auth)",
			"stdio",
		)
		.option("--port <n>", "SSE port (only when --transport=sse; default 7078)")
		.option(
			"--host <host>",
			"SSE bind host (only when --transport=sse; default 0.0.0.0)",
			"0.0.0.0",
		)
		.action(async (options) => {
			// Logs go to stderr; stdio transport owns stdout.
			process.env.LOG_LEVEL = process.env.LOG_LEVEL ?? "info";

			const transport = String(options.transport ?? "stdio");
			if (transport === "stdio") {
				const { startMcpServer } = await import("../../mcp/server.js");
				try {
					await startMcpServer();
				} catch (err) {
					console.error("Fatal error:", err);
					process.exit(1);
				}
				return;
			}

			if (transport !== "sse") {
				console.error(`unknown --transport: ${transport} (expected stdio | sse)`);
				process.exit(2);
			}

			// A4 · runtime-trust. SSE mode.
			const token = process.env.MEMORY_MCP_AUTH_TOKEN;
			if (!token || token.trim().length === 0) {
				console.error(
					"MEMORY_MCP_AUTH_TOKEN is required when --transport=sse (set a non-empty bearer token)",
				);
				process.exit(2);
			}
			let port: number;
			try {
				port = parsePort(options.port, 7078);
			} catch (err) {
				console.error(err instanceof Error ? err.message : String(err));
				process.exit(2);
				return;
			}
			const { startMcpSseServer } = await import("../../mcp/sse-server.js");
			const { logger } = await import("../../utils/logger.js");
			const { closeDb } = await import("../../db/connection.js");

			const handle = await startMcpSseServer({ port, token: token as string, host: options.host });
			logger.info(
				{ port: handle.port, host: options.host },
				"mcp-sse: listening — GET /sse · POST /message",
			);

			const shutdown = async (signal: NodeJS.Signals) => {
				logger.info({ signal }, "mcp-sse: shutting down");
				try {
					await handle.close();
				} catch (err) {
					logger.warn({ err }, "mcp-sse: error closing listener");
				}
				try {
					await closeDb();
				} catch {}
				process.exit(0);
			};
			process.on("SIGTERM", () => void shutdown("SIGTERM"));
			process.on("SIGINT", () => void shutdown("SIGINT"));

			// Keep the event loop alive. The HTTP listener does this already,
			// but we want an explicit anchor in case a bug closes it early.
			await new Promise<void>(() => {});
		});
}
