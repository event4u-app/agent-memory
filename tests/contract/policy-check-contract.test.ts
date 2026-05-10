// C2 · runtime-trust — contract test for `memory policy check` envelope.
//
// Pins the JSON shape emitted by `runPolicyCheck` (policy-check-v1). The
// schema runs with `additionalProperties: false` on every object, so
// drift on either side — service or consumer — fails early.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import Ajv from "ajv";
import addFormats from "ajv-formats";
import { describe, expect, it } from "vitest";

import type { PolicyCheckReport } from "../../src/quality/policy-check.service.js";

const FIXTURE_DIR = join(process.cwd(), "tests/fixtures/retrieval");

function load<T = unknown>(file: string): T {
	return JSON.parse(readFileSync(join(FIXTURE_DIR, file), "utf-8")) as T;
}

const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);
const schema = load("policy-check-v1.schema.json");
const validate = ajv.compile(schema);

function assertValid(label: string, ok: boolean, errors: unknown): void {
	if (!ok) {
		throw new Error(
			`policy-check-v1 validation failed for ${label}: ${JSON.stringify(errors, null, 2)}`,
		);
	}
}

describe("policy-check contract v1 — schema conformance", () => {
	it("golden-policy-check.json validates against the schema", () => {
		const golden = load<PolicyCheckReport>("golden-policy-check.json");
		assertValid("golden", validate(golden), validate.errors);
	});

	it("empty report (no policies configured) validates", () => {
		const empty: PolicyCheckReport = {
			contract_version: "policy-check-v1",
			status: "pass",
			repository: null,
			policies_evaluated: [],
			summary: { violations: 0, policies_failed: 0 },
			violations: [],
		};
		assertValid("empty", validate(empty), validate.errors);
	});

	it("rejects an unknown top-level field", () => {
		const golden = load<PolicyCheckReport>("golden-policy-check.json");
		const withExtra = { ...golden, bogus: true };
		expect(validate(withExtra)).toBe(false);
	});

	it("rejects an unknown policy name in policies_evaluated", () => {
		const golden = load<PolicyCheckReport>("golden-policy-check.json");
		const withBadPolicy = {
			...golden,
			policies_evaluated: [...golden.policies_evaluated, "fail_on_moon_phase"],
		};
		expect(validate(withBadPolicy)).toBe(false);
	});

	it("rejects a violation missing required fields", () => {
		const golden = load<PolicyCheckReport>("golden-policy-check.json");
		const { message: _m, ...partial } = golden.violations[0]!;
		const withBadViolation = { ...golden, violations: [partial] };
		expect(validate(withBadViolation)).toBe(false);
	});

	it("rejects a trust_score outside [0,1]", () => {
		const golden = load<PolicyCheckReport>("golden-policy-check.json");
		const withBadScore = {
			...golden,
			violations: [{ ...golden.violations[0], trust_score: 1.5 }],
		};
		expect(validate(withBadScore)).toBe(false);
	});
});
