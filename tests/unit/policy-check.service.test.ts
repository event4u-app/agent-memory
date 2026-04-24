// C2 · runtime-trust — pure-logic tests for the policy engine.
//
// The service takes a `PolicyFetchers` dependency so we can exercise the
// policy matrix (enabled / disabled / threshold / global / scoped) with
// in-memory fixtures — no Postgres, no network.

import { describe, expect, it } from "vitest";
import {
	type EntryRow,
	type PolicyInput,
	runPolicyCheck,
} from "../../src/quality/policy-check.service.js";
import type { PolicyFetchers } from "../../src/quality/policy-check-fetchers.js";

function row(overrides: Partial<EntryRow> = {}): EntryRow {
	return {
		id: overrides.id ?? "00000000-0000-0000-0000-000000000001",
		type: overrides.type ?? "architecture_decision",
		title: overrides.title ?? "Test entry",
		trust_status: overrides.trust_status ?? "validated",
		trust_score: overrides.trust_score ?? 0.5,
		impact_level: overrides.impact_level ?? "high",
	};
}

interface FetcherOverrides {
	contradictedCritical?: EntryRow[];
	invalidatedAdr?: EntryRow[];
	lowTrustAdr?: EntryRow[];
	poisoned?: EntryRow[];
}

function mockFetchers(over: FetcherOverrides = {}): PolicyFetchers & {
	calls: { method: string; repository: string | null; threshold?: number }[];
} {
	const calls: { method: string; repository: string | null; threshold?: number }[] = [];
	return {
		calls,
		async fetchContradictedCritical(repository) {
			calls.push({ method: "fetchContradictedCritical", repository });
			return over.contradictedCritical ?? [];
		},
		async fetchInvalidatedAdr(repository) {
			calls.push({ method: "fetchInvalidatedAdr", repository });
			return over.invalidatedAdr ?? [];
		},
		async fetchLowTrustAdr(repository, threshold) {
			calls.push({ method: "fetchLowTrustAdr", repository, threshold });
			return over.lowTrustAdr ?? [];
		},
		async fetchPoisoned(repository) {
			calls.push({ method: "fetchPoisoned", repository });
			return over.poisoned ?? [];
		},
	};
}

describe("runPolicyCheck", () => {
	it("returns an empty pass report when no policies are configured", async () => {
		const fetchers = mockFetchers();
		const report = await runPolicyCheck({
			fetchers,
			policies: {} as PolicyInput,
			repository: null,
		});
		expect(report.status).toBe("pass");
		expect(report.policies_evaluated).toEqual([]);
		expect(report.violations).toEqual([]);
		expect(report.summary).toEqual({ violations: 0, policies_failed: 0 });
		expect(fetchers.calls).toEqual([]);
	});

	it("skips disabled policies (false / unset) — no fetcher call, no report row", async () => {
		const fetchers = mockFetchers({
			contradictedCritical: [row({ impact_level: "critical" })],
		});
		const report = await runPolicyCheck({
			fetchers,
			policies: {
				fail_on_contradicted_critical: false,
				fail_on_invalidated_adr: false,
			} as PolicyInput,
			repository: null,
		});
		expect(report.status).toBe("pass");
		expect(report.policies_evaluated).toEqual([]);
		expect(fetchers.calls).toEqual([]);
	});

	it("fails on a critical contradicted entry", async () => {
		const fetchers = mockFetchers({
			contradictedCritical: [
				row({ id: "c1", impact_level: "critical", trust_score: 0.72, title: "Rule A" }),
			],
		});
		const report = await runPolicyCheck({
			fetchers,
			policies: { fail_on_contradicted_critical: true } as PolicyInput,
			repository: "acme/checkout",
		});
		expect(report.status).toBe("fail");
		expect(report.policies_evaluated).toEqual(["fail_on_contradicted_critical"]);
		expect(report.violations).toHaveLength(1);
		expect(report.violations[0]).toMatchObject({
			policy: "fail_on_contradicted_critical",
			entry_id: "c1",
			trust_score: 0.72,
		});
		expect(report.violations[0]?.message).toContain("0.72");
		expect(report.summary).toEqual({ violations: 1, policies_failed: 1 });
		expect(fetchers.calls).toEqual([
			{ method: "fetchContradictedCritical", repository: "acme/checkout" },
		]);
	});

	it("evaluates min_trust_for_type.architecture_decision and forwards the threshold", async () => {
		const fetchers = mockFetchers({
			lowTrustAdr: [row({ id: "a1", trust_score: 0.42 })],
		});
		const report = await runPolicyCheck({
			fetchers,
			policies: {
				min_trust_for_type: { architecture_decision: 0.7 },
			} as PolicyInput,
			repository: null,
		});
		expect(report.policies_evaluated).toEqual(["min_trust_for_type.architecture_decision"]);
		expect(report.violations[0]?.message).toContain("0.42");
		expect(report.violations[0]?.message).toContain("0.70");
		expect(fetchers.calls).toEqual([
			{ method: "fetchLowTrustAdr", repository: null, threshold: 0.7 },
		]);
	});

	it("aggregates violations across all four policies and counts failed policies once", async () => {
		const fetchers = mockFetchers({
			contradictedCritical: [row({ id: "c1", impact_level: "critical" })],
			invalidatedAdr: [row({ id: "a1", trust_status: "invalidated" })],
			lowTrustAdr: [row({ id: "a2", trust_score: 0.3 }), row({ id: "a3", trust_score: 0.4 })],
			poisoned: [row({ id: "p1", trust_status: "poisoned" })],
		});
		const report = await runPolicyCheck({
			fetchers,
			policies: {
				fail_on_contradicted_critical: true,
				fail_on_invalidated_adr: true,
				min_trust_for_type: { architecture_decision: 0.5 },
				block_on_poisoned_referenced: true,
			} as PolicyInput,
			repository: "acme/checkout",
		});
		expect(report.status).toBe("fail");
		expect(report.policies_evaluated).toHaveLength(4);
		expect(report.violations).toHaveLength(5);
		expect(report.summary).toEqual({ violations: 5, policies_failed: 4 });
	});
});
