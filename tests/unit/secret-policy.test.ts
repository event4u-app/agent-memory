import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_SECRET_POLICY, resolveSecretPolicy } from "../../src/security/secret-policy.js";

const ORIGINAL_ENV = process.env.MEMORY_SECRET_POLICY;

describe("resolveSecretPolicy", () => {
	afterEach(() => {
		if (ORIGINAL_ENV === undefined) {
			process.env.MEMORY_SECRET_POLICY = undefined;
			delete process.env.MEMORY_SECRET_POLICY;
		} else {
			process.env.MEMORY_SECRET_POLICY = ORIGINAL_ENV;
		}
	});

	it("defaults to reject when nothing is provided", () => {
		expect(resolveSecretPolicy(undefined)).toBe("reject");
		expect(DEFAULT_SECRET_POLICY).toBe("reject");
	});

	it("accepts `redact` as an explicit opt-out", () => {
		expect(resolveSecretPolicy("redact")).toBe("redact");
		expect(resolveSecretPolicy(" REDACT ")).toBe("redact");
	});

	it("returns reject for any unknown value (no silent downgrade)", () => {
		expect(resolveSecretPolicy("allow")).toBe("reject");
		expect(resolveSecretPolicy("off")).toBe("reject");
		expect(resolveSecretPolicy("")).toBe("reject");
	});

	it("reads MEMORY_SECRET_POLICY from env when no argument is passed", () => {
		process.env.MEMORY_SECRET_POLICY = "redact";
		expect(resolveSecretPolicy()).toBe("redact");
		process.env.MEMORY_SECRET_POLICY = "reject";
		expect(resolveSecretPolicy()).toBe("reject");
	});
});
