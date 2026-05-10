import type { Command } from "commander";
import { healthCheck } from "../../db/connection.js";
import { closeDb, parseServePort } from "../context.js";

export function register(program: Command): void {
	program
		.command("serve")
		.description(
			"Long-running supervisor for container deployments — runs migrations, then idles until SIGTERM (see ADR-0002)",
		)
		.action(async () => {
			// Supervisor mode: logs belong on stderr; stdout stays quiet for
			// operators tailing container output.
			process.env.LOG_LEVEL = process.env.LOG_LEVEL ?? "info";
			const { runMigrations, listPendingMigrations } = await import("../../db/migrate.js");
			const { logger } = await import("../../utils/logger.js");
			const { enableMetrics } = await import("../../observability/metrics.js");
			const { startServeHttp } = await import("../serve-http.js");

			// A2 · runtime-trust. Metrics are opt-in so lean CLI invocations don't
			// pay the registry cost. Initialising eagerly means the first scrape
			// returns every declared metric (including zero-value counters).
			const metricsOn = process.env.MEMORY_METRICS_ENABLED === "true";
			if (metricsOn) enableMetrics();

			try {
				const result = await runMigrations();
				logger.info(
					{ applied: result.applied, skipped: result.skipped.length },
					"serve: migrations up-to-date",
				);
			} catch (err) {
				logger.error({ err }, "serve: migrations failed — continuing, retry with 'memory migrate'");
			}

			// HTTP surface (A1 · runtime-trust). Opt-in via MEMORY_HTTP_PORT.
			// Unset / empty → supervisor runs socket-free (pre-A1 behavior).
			let httpHandle: { close: () => Promise<void> } | null = null;
			const httpPort = parseServePort(process.env.MEMORY_HTTP_PORT);
			if (httpPort != null) {
				try {
					httpHandle = await startServeHttp({
						port: httpPort,
						checkHealth: () => healthCheck(),
						listPending: () => listPendingMigrations(),
						metricsEnabled: metricsOn,
					});
					logger.info(
						{ port: httpPort, metrics: metricsOn },
						metricsOn
							? "serve: http endpoints listening — /health /ready /metrics"
							: "serve: http endpoints listening — /health /ready",
					);
				} catch (err) {
					logger.error(
						{ err, port: httpPort },
						"serve: http listener failed — continuing without /health /ready",
					);
				}
			}

			// Keep the event loop alive. Without an active handle, Node would
			// detect the unsettled top-level await below and exit immediately
			// (`Detected unsettled top-level await` warning). A long-period
			// no-op interval is the cheapest way to park a supervisor process
			// without a scheduler or network listener.
			const keepAlive = setInterval(() => {}, 1 << 30);

			const shutdown = async (signal: NodeJS.Signals) => {
				clearInterval(keepAlive);
				logger.info({ signal }, "serve: shutting down");
				if (httpHandle) {
					try {
						await httpHandle.close();
					} catch (err) {
						logger.warn({ err }, "serve: error closing http listener");
					}
				}
				try {
					await closeDb();
				} catch (err) {
					logger.warn({ err }, "serve: error closing database pool");
				}
				process.exit(0);
			};
			process.on("SIGTERM", () => void shutdown("SIGTERM"));
			process.on("SIGINT", () => void shutdown("SIGINT"));

			logger.info("serve: supervisor ready — awaiting SIGTERM");
			// Park forever. When in-process timers land (ADR-0002 non-goal)
			// the keepAlive interval becomes the scheduler tick.
			await new Promise<void>(() => {});
		});
}
