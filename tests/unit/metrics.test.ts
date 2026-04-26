// A2 · runtime-trust — Prometheus metric instrumentation.
//
// Asserts that the four roadmap-mandated instruments increment at the
// correct call-sites. Tests rebuild the registry up-front and route the
// helper functions at it so no shared state leaks between cases.

import { beforeEach, describe, expect, it } from "vitest";
import {
	buildMetrics,
	enableMetrics,
	metricsEnabled,
	observeRetrieveDuration,
	recordEmbeddingFallback,
	recordTrustTransition,
	resetMetricsForTesting,
	setDbPoolSaturation,
} from "../../src/observability/metrics.js";

describe("observability/metrics", () => {
	beforeEach(() => {
		resetMetricsForTesting();
	});

	it("helpers are no-ops until the registry is enabled", async () => {
		expect(metricsEnabled()).toBe(false);
		// None of these should throw or allocate.
		observeRetrieveDuration(0.123);
		recordEmbeddingFallback("openai", "local");
		recordTrustTransition("quarantined", "validated");
		setDbPoolSaturation(0.5);
		expect(metricsEnabled()).toBe(false);
	});

	it("enableMetrics() wires a shared registry and flips the flag", async () => {
		const handles = enableMetrics();
		expect(metricsEnabled()).toBe(true);
		const text = await handles.registry.metrics();
		// Zero-value counters still show up in the exposition.
		expect(text).toContain("agent_memory_retrieve_duration_seconds");
		expect(text).toContain("agent_memory_embedding_fallback_total");
		expect(text).toContain("agent_memory_trust_transitions_total");
		expect(text).toContain("agent_memory_db_pool_saturation");
	});

	it("observeRetrieveDuration records to the histogram", async () => {
		const handles = enableMetrics();
		observeRetrieveDuration(0.042);
		const snapshot = await handles.registry
			.getSingleMetric("agent_memory_retrieve_duration_seconds")
			?.get();
		const sumSample = snapshot?.values.find((v) => v.metricName?.endsWith("_sum"));
		expect(sumSample?.value).toBeCloseTo(0.042, 5);
	});

	it("recordEmbeddingFallback tags the from/to labels", async () => {
		const handles = enableMetrics();
		recordEmbeddingFallback("openai", "local");
		recordEmbeddingFallback("openai", "local");
		recordEmbeddingFallback("local", "none");
		const snapshot = await handles.registry
			.getSingleMetric("agent_memory_embedding_fallback_total")
			?.get();
		const openaiLocal = snapshot?.values.find(
			(v) => v.labels.from === "openai" && v.labels.to === "local",
		);
		const localNone = snapshot?.values.find(
			(v) => v.labels.from === "local" && v.labels.to === "none",
		);
		expect(openaiLocal?.value).toBe(2);
		expect(localNone?.value).toBe(1);
	});

	it("recordTrustTransition tags the from/to labels", async () => {
		const handles = enableMetrics();
		recordTrustTransition("quarantined", "validated");
		recordTrustTransition("validated", "stale");
		const snapshot = await handles.registry
			.getSingleMetric("agent_memory_trust_transitions_total")
			?.get();
		const promoted = snapshot?.values.find(
			(v) => v.labels.from === "quarantined" && v.labels.to === "validated",
		);
		expect(promoted?.value).toBe(1);
	});

	it("setDbPoolSaturation overrides the gauge value", async () => {
		const handles = enableMetrics();
		setDbPoolSaturation(0.7);
		setDbPoolSaturation(0.85);
		const snapshot = await handles.registry
			.getSingleMetric("agent_memory_db_pool_saturation")
			?.get();
		expect(snapshot?.values[0]?.value).toBe(0.85);
	});

	it("buildMetrics() produces an isolated registry per call", async () => {
		const a = buildMetrics();
		const b = buildMetrics();
		expect(a.registry).not.toBe(b.registry);
		a.retrieveDurationSeconds.observe(0.01);
		const aText = await a.registry.metrics();
		const bText = await b.registry.metrics();
		// Only `a` saw the observation.
		expect(aText).toMatch(/agent_memory_retrieve_duration_seconds_count \d+/);
		expect(bText).toMatch(/agent_memory_retrieve_duration_seconds_count 0/);
	});
});
