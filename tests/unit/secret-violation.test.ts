import { describe, expect, it } from "vitest";
import {
	createSecretViolation,
	SECRET_VIOLATION_EXIT_CODE,
} from "../../src/security/secret-violation.js";

describe("createSecretViolation", () => {
	it("wraps detections and policy in the contract-locked envelope", () => {
		const v = createSecretViolation(
			[
				{
					code: "SECRET_DETECTED",
					pattern: "github_token",
					field: "summary",
					offsetRanges: [{ start: 10, end: 50 }],
				},
			],
			"reject",
		);

		expect(v.code).toBe("INGRESS_POLICY_VIOLATION");
		expect(v.policy).toBe("reject");
		expect(v.detections).toHaveLength(1);
		expect(v.detections[0]?.pattern).toBe("github_token");
		expect(v.suggestion).toMatch(/GITHUB_TOKEN|reference/);
	});

	it("throws when the detection list is empty (no meaningful violation)", () => {
		expect(() => createSecretViolation([], "reject")).toThrow(/at least one detection/);
	});

	it("never echoes the secret value back — only pattern names and offsets", () => {
		const v = createSecretViolation(
			[
				{
					code: "SECRET_DETECTED",
					pattern: "aws_access_key",
					offsetRanges: [{ start: 0, end: 20 }],
				},
			],
			"reject",
		);
		const serialized = JSON.stringify(v);
		expect(serialized).not.toMatch(/AKIA[0-9A-Z]{16}/);
		expect(serialized).toContain("aws_access_key");
	});

	it("exposes a stable exit code distinct from generic failures", () => {
		expect(SECRET_VIOLATION_EXIT_CODE).toBe(3);
	});
});
