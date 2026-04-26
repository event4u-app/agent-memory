import { readFileSync } from "node:fs";
import { join } from "node:path";
import Ajv from "ajv";
import { describe, expect, it } from "vitest";
import { createSecretViolation } from "../../src/security/secret-violation.js";

const FIXTURE_DIR = join(process.cwd(), "tests/fixtures/retrieval");

function load<T = unknown>(file: string): T {
	return JSON.parse(readFileSync(join(FIXTURE_DIR, file), "utf-8")) as T;
}

const ajv = new Ajv({ allErrors: true, strict: false });
const schema = load("secret-violation-v1.schema.json");
const validate = ajv.compile(schema);

describe("secret-violation-v1 contract", () => {
	it("validates a minimal violation (single SECRET_DETECTED)", () => {
		const v = createSecretViolation(
			[{ code: "SECRET_DETECTED", pattern: "github_token" }],
			"reject",
		);
		const ok = validate(v);
		expect(validate.errors).toBeNull();
		expect(ok).toBe(true);
	});

	it("validates a violation with multiple detection categories", () => {
		const v = createSecretViolation(
			[
				{
					code: "SECRET_DETECTED",
					pattern: "aws_access_key",
					field: "summary",
					offsetRanges: [{ start: 12, end: 32 }],
				},
				{ code: "PII_DETECTED", pattern: "email", field: "details" },
				{ code: "ENV_VALUE_DETECTED", pattern: "env_var_value" },
				{ code: "HIGH_ENTROPY_DETECTED", pattern: "high_entropy" },
			],
			"redact",
		);
		expect(validate(v)).toBe(true);
		expect(validate.errors).toBeNull();
	});

	it("rejects unknown top-level fields (additionalProperties: false)", () => {
		const bad = {
			code: "INGRESS_POLICY_VIOLATION",
			policy: "reject",
			detections: [{ code: "SECRET_DETECTED", pattern: "x" }],
			suggestion: "s",
			extra: "nope",
		};
		expect(validate(bad)).toBe(false);
	});

	it("rejects a policy value outside the enum", () => {
		const bad = {
			code: "INGRESS_POLICY_VIOLATION",
			policy: "ignore",
			detections: [{ code: "SECRET_DETECTED", pattern: "x" }],
			suggestion: "s",
		};
		expect(validate(bad)).toBe(false);
	});

	it("rejects an empty detection list", () => {
		const bad = {
			code: "INGRESS_POLICY_VIOLATION",
			policy: "reject",
			detections: [],
			suggestion: "s",
		};
		expect(validate(bad)).toBe(false);
	});
});
