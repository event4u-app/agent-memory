import { readFileSync } from "node:fs";
import { join } from "node:path";
import Ajv from "ajv";
import addFormats from "ajv-formats";
import { describe, expect, it } from "vitest";
import { buildReviewDigest, type ReviewDigestV1 } from "../../src/quality/review.service.js";

const FIXTURE_DIR = join(process.cwd(), "tests/fixtures/retrieval");

function load<T = unknown>(file: string): T {
	return JSON.parse(readFileSync(join(FIXTURE_DIR, file), "utf-8")) as T;
}

const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);
const schema = load("review-weekly-v1.schema.json");
const validate = ajv.compile(schema);

function assertValid(label: string, ok: boolean, errors: unknown): void {
	if (!ok) {
		throw new Error(
			`review-weekly-v1 validation failed for ${label}: ${JSON.stringify(errors, null, 2)}`,
		);
	}
}

describe("review-weekly contract v1 — schema conformance", () => {
	it("golden-review-weekly.json validates against review-weekly-v1.schema.json", () => {
		const golden = load<ReviewDigestV1>("golden-review-weekly.json");
		assertValid("golden", validate(golden), validate.errors);
	});

	it("live buildReviewDigest output validates", () => {
		const digest = buildReviewDigest({
			staleHighValue: [
				{
					id: "e1",
					title: "Critical doc",
					impactLevel: "critical",
					trustScore: 0.72,
					daysSinceValidation: 45,
				},
			],
			contradictions: [
				{
					id: "c1",
					entryAId: "a1",
					entryATitle: "A",
					entryBId: "b1",
					entryBTitle: "B",
					description: "conflict",
					createdAt: new Date("2025-07-10T09:30:00.000Z"),
				},
			],
			poisonCandidates: [
				{ entryId: "p1", title: "Poison", trustScore: 0.28, invalidationCount: 4 },
			],
			generatedAt: new Date("2025-07-14T12:00:00.000Z"),
		});
		assertValid("live", validate(digest), validate.errors);
	});

	it("empty digest still validates", () => {
		const digest = buildReviewDigest({
			staleHighValue: [],
			contradictions: [],
			poisonCandidates: [],
			generatedAt: new Date("2025-07-14T12:00:00.000Z"),
		});
		assertValid("empty", validate(digest), validate.errors);
		expect(digest.cases).toHaveLength(0);
	});

	it("rejects unknown top-level fields (additionalProperties: false)", () => {
		const digest = buildReviewDigest({
			staleHighValue: [],
			contradictions: [],
			poisonCandidates: [],
		}) as ReviewDigestV1 & { extra?: string };
		digest.extra = "leaking-field";
		expect(validate(digest)).toBe(false);
	});

	it("rejects unknown case fields (additionalProperties: false on cases)", () => {
		const digest = buildReviewDigest({
			staleHighValue: [
				{
					id: "e1",
					title: "x",
					impactLevel: "high",
					trustScore: 0.5,
					daysSinceValidation: 10,
				},
			],
			contradictions: [],
			poisonCandidates: [],
		});
		(digest.cases[0] as Record<string, unknown>).extra = "nope";
		expect(validate(digest)).toBe(false);
	});
});
