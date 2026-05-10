// A2 · runtime-trust — Prometheus metrics registry.
//
// Central registry for the four roadmap-mandated metrics and any future
// instruments. All instruments are safe to import from any module: the
// registry is lazily initialised on first access so CLI one-shot commands
// don't pay the metrics cost when `MEMORY_METRICS_ENABLED=false`.
//
// Exposition rules:
//   - `/metrics` is served only when `MEMORY_METRICS_ENABLED=true` AND
//     `MEMORY_HTTP_PORT` is set (guarded in src/cli/serve-http.ts).
//   - Metric names use the `agent_memory_` prefix — stable, roadmap-locked.
//   - Labels are bounded cardinality (never user-free-text).

import { Counter, collectDefaultMetrics, Gauge, Histogram, Registry } from "prom-client";

export const METRICS_PREFIX = "agent_memory_";

export interface MetricsHandles {
	registry: Registry;
	retrieveDurationSeconds: Histogram<string>;
	dbPoolSaturation: Gauge<string>;
	embeddingFallbackTotal: Counter<string>;
	trustTransitionsTotal: Counter<"from" | "to">;
}

let handles: MetricsHandles | null = null;

/**
 * Build a fresh metrics bundle. Used directly by tests; production code
 * should call `getMetrics()` so that a single registry is shared.
 */
export function buildMetrics(): MetricsHandles {
	const registry = new Registry();
	collectDefaultMetrics({ register: registry, prefix: METRICS_PREFIX });

	const retrieveDurationSeconds = new Histogram({
		name: `${METRICS_PREFIX}retrieve_duration_seconds`,
		help: "Wall-clock time spent in RetrievalEngine.retrieve() — SLO target: P50<50ms, P95<200ms, P99<500ms (see docs/operations.md).",
		buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.2, 0.5, 1, 2, 5],
		registers: [registry],
	});

	const dbPoolSaturation = new Gauge({
		name: `${METRICS_PREFIX}db_pool_saturation`,
		help: "Postgres connection pool saturation (0.0-1.0). Sampled by the serve supervisor; rises as active connections approach the pool cap.",
		registers: [registry],
	});

	const embeddingFallbackTotal = new Counter({
		name: `${METRICS_PREFIX}embedding_fallback_total`,
		help: "Count of embedding chain hops: one increment per provider failure OR per bm25-only short-circuit. Labels: from (failing provider), to (next provider or 'none').",
		labelNames: ["from", "to"] as const,
		registers: [registry],
	});

	const trustTransitionsTotal = new Counter({
		name: `${METRICS_PREFIX}trust_transitions_total`,
		help: "Count of trust-status transitions. Labels: from, to (both TrustStatus values).",
		labelNames: ["from", "to"] as const,
		registers: [registry],
	});

	return {
		registry,
		retrieveDurationSeconds,
		dbPoolSaturation,
		embeddingFallbackTotal,
		trustTransitionsTotal,
	};
}

/**
 * Lazy singleton. Safe to call from hot paths — no allocation after the
 * first call.
 */
export function getMetrics(): MetricsHandles {
	if (!handles) handles = buildMetrics();
	return handles;
}

/**
 * Test helper — flush the singleton so each test can assert against a
 * fresh registry. Never call from production code.
 */
export function resetMetricsForTesting(): void {
	handles = null;
}

/**
 * Hot-path helpers — no-op when metrics never initialised, O(1) when
 * already alive. Kept deliberately small so production code stays
 * readable (see src/retrieval/engine.ts for the usage pattern).
 */
export function observeRetrieveDuration(seconds: number): void {
	if (!handles) return;
	handles.retrieveDurationSeconds.observe(seconds);
}

export function recordEmbeddingFallback(from: string, to: string): void {
	if (!handles) return;
	handles.embeddingFallbackTotal.inc({ from, to });
}

export function recordTrustTransition(from: string, to: string): void {
	if (!handles) return;
	handles.trustTransitionsTotal.inc({ from, to });
}

export function setDbPoolSaturation(value: number): void {
	if (!handles) return;
	handles.dbPoolSaturation.set(value);
}

/**
 * `true` when metrics have been initialised (i.e. `memory serve` with
 * MEMORY_METRICS_ENABLED=true). Used by the HTTP surface to decide
 * whether to expose /metrics at all.
 */
export function metricsEnabled(): boolean {
	return handles !== null;
}

/**
 * Force-initialise the registry. Called once from the `memory serve`
 * entrypoint when `MEMORY_METRICS_ENABLED=true` so the first scrape
 * returns every metric (including zero-value counters).
 */
export function enableMetrics(): MetricsHandles {
	if (!handles) handles = buildMetrics();
	return handles;
}
