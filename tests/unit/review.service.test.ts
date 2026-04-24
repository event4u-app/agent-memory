import { describe, expect, it } from "vitest";
import { buildReviewDigest, type ReviewDigestInputs } from "../../src/quality/review.service.js";

function baseInputs(overrides: Partial<ReviewDigestInputs> = {}): ReviewDigestInputs {
	return {
		staleHighValue: [
			{
				id: "e1",
				title: "Critical auth doc",
				impactLevel: "critical",
				trustScore: 0.72,
				daysSinceValidation: 45,
			},
		],
		contradictions: [
			{
				id: "c1",
				entryAId: "a1",
				entryATitle: "Retry 3x",
				entryBId: "b1",
				entryBTitle: "Never retry",
				description: "Retry policy conflict",
				createdAt: new Date("2025-07-10T09:30:00.000Z"),
			},
		],
		poisonCandidates: [
			{
				entryId: "p1",
				title: "Memoize all helpers",
				trustScore: 0.28,
				invalidationCount: 4,
			},
		],
		generatedAt: new Date("2025-07-14T12:00:00.000Z"),
		...overrides,
	};
}

describe("buildReviewDigest", () => {
	it("emits the review-weekly-v1 envelope with one case per kind", () => {
		const d = buildReviewDigest(baseInputs());
		expect(d.contract_version).toBe("review-weekly-v1");
		expect(d.generated_at).toBe("2025-07-14T12:00:00.000Z");
		expect(d.summary).toEqual({
			stale_high_value: 1,
			contradictions: 1,
			poison_candidates: 1,
			deferred: 0,
		});
		expect(d.cases).toHaveLength(3);
	});

	it("prefixes case_ids by kind so the defer-filter keys deterministically", () => {
		const d = buildReviewDigest(baseInputs());
		const ids = d.cases.map((c) => c.case_id).sort();
		expect(ids).toEqual(["contradiction:c1", "poison:p1", "stale:e1"]);
	});

	it("suppresses deferred case_ids and increments summary.deferred", () => {
		const d = buildReviewDigest(
			baseInputs({ deferredCaseIds: new Set(["stale:e1", "poison:p1"]) }),
		);
		expect(d.cases.map((c) => c.kind)).toEqual(["contradiction"]);
		expect(d.summary).toEqual({
			stale_high_value: 0,
			contradictions: 1,
			poison_candidates: 0,
			deferred: 2,
		});
	});

	it("rounds days_since_validation to an integer — schema requires int", () => {
		const d = buildReviewDigest(
			baseInputs({
				staleHighValue: [
					{
						id: "e2",
						title: "x",
						impactLevel: "high",
						trustScore: 0.5,
						daysSinceValidation: 12.6,
					},
				],
			}),
		);
		const stale = d.cases.find((c) => c.kind === "stale_high_value");
		expect(stale).toBeDefined();
		if (stale?.kind === "stale_high_value") {
			expect(stale.days_since_validation).toBe(13);
			expect(Number.isInteger(stale.days_since_validation)).toBe(true);
		}
	});

	it("returns an empty case list when every kind is empty", () => {
		const d = buildReviewDigest({
			staleHighValue: [],
			contradictions: [],
			poisonCandidates: [],
		});
		expect(d.cases).toHaveLength(0);
		expect(d.summary.deferred).toBe(0);
	});

	it("hints are actionable strings per kind — no leaked internal ids", () => {
		const d = buildReviewDigest(baseInputs());
		for (const c of d.cases) {
			expect(c.hint).toMatch(/^[A-Z]/);
			expect(c.hint).not.toContain(c.case_id);
		}
	});
});
