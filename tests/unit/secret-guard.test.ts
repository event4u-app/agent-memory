import { describe, expect, it } from "vitest";
import {
	enforceNoSecrets,
	SecretViolationError,
	scanForSecrets,
} from "../../src/security/secret-guard.js";

describe("scanForSecrets — pattern coverage", () => {
	it("detects AWS access keys", () => {
		const d = scanForSecrets("config: AKIAABCDEFGHIJKLMNOP in use");
		expect(d.map((x) => x.pattern)).toContain("aws_access_key");
	});

	it("detects GitHub personal access tokens", () => {
		const d = scanForSecrets("token ghp_0123456789abcdefghijklmnopqrstuvwxyz01");
		expect(d.map((x) => x.pattern)).toContain("github_token");
	});

	it("detects npm tokens", () => {
		const d = scanForSecrets("NPM_TOKEN=npm_0123456789abcdefghijklmnopqrstuvwxyz01");
		expect(d.map((x) => x.pattern).some((p) => p === "npm_token")).toBe(true);
	});

	it("detects JWTs", () => {
		const jwt = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkw.abcdefghijklmno";
		expect(scanForSecrets(jwt).map((x) => x.pattern)).toContain("jwt");
	});

	it("detects postgres/mysql/redis/mongodb connection strings", () => {
		const d = scanForSecrets("DB=postgres://user:pw@host:5432/db");
		expect(d.map((x) => x.pattern)).toContain("connection_string");
	});

	it("detects PEM PRIVATE KEY blocks", () => {
		const k = "-----BEGIN RSA PRIVATE KEY-----\nABCDEF\n-----END RSA PRIVATE KEY-----";
		expect(scanForSecrets(k).map((x) => x.pattern)).toContain("private_key_pem");
	});

	it("detects OPENSSH PRIVATE KEY blocks", () => {
		const k = "-----BEGIN OPENSSH PRIVATE KEY-----\nABCDEF\n-----END OPENSSH PRIVATE KEY-----";
		expect(scanForSecrets(k).map((x) => x.pattern)).toContain("openssh_private_key");
	});

	it("detects generic api_key= / token= assignments", () => {
		const d = scanForSecrets("api_key: abcdef1234567890abcdef");
		expect(d.map((x) => x.pattern)).toContain("generic_key_token_secret");
	});

	it("detects email addresses as PII", () => {
		const d = scanForSecrets("Contact: jane.doe@example.com");
		const email = d.find((x) => x.pattern === "email");
		expect(email?.code).toBe("PII_DETECTED");
	});

	it("detects .env-style KEY=VALUE lines", () => {
		const d = scanForSecrets("DATABASE_URL=postgres://x\nAPI_KEY=ZZZZZZZZZZZZZZZZZZ");
		const env = d.find((x) => x.pattern === "env_var_value");
		expect(env?.code).toBe("ENV_VALUE_DETECTED");
	});

	it("detects quoted high-entropy strings", () => {
		// Base64-like 40-char random secret, entropy > 4.0, chars from [A-Za-z0-9+/=_-].
		const d = scanForSecrets('let key = "a7F9xQv2Lp3Wz8Yt4Bc6Dn1Eh5Mj0Ks9Rb2Gu4Xq7V"');
		expect(d.map((x) => x.pattern)).toContain("high_entropy");
	});

	it("returns empty array for clean input", () => {
		expect(scanForSecrets("a plain architecture note about invoice calculation")).toEqual([]);
	});

	it("never echoes the secret value back in detections", () => {
		const secret = "AKIAABCDEFGHIJKLMNOP";
		const d = scanForSecrets(`hidden: ${secret}`);
		expect(JSON.stringify(d)).not.toContain(secret);
	});

	it("attaches `field` to detections when provided", () => {
		const d = scanForSecrets("ghp_0123456789abcdefghijklmnopqrstuvwxyz01", "summary");
		expect(d[0]?.field).toBe("summary");
	});

	it("records accurate byte offsets", () => {
		const text = "prefix AKIAABCDEFGHIJKLMNOP suffix";
		const d = scanForSecrets(text);
		const range = d.find((x) => x.pattern === "aws_access_key")?.offsetRanges?.[0];
		expect(range?.start).toBe(7);
		expect(range?.end).toBe(27);
	});
});

describe("enforceNoSecrets — policy gate", () => {
	it("returns null for clean input under reject", () => {
		expect(enforceNoSecrets({ summary: "clean text" }, "reject")).toBeNull();
	});

	it("throws SecretViolationError under reject when a secret is present", () => {
		expect(() => enforceNoSecrets({ summary: "leaked AKIAABCDEFGHIJKLMNOP" }, "reject")).toThrow(
			SecretViolationError,
		);
	});

	it("returns a violation (does not throw) under redact policy", () => {
		const v = enforceNoSecrets({ summary: "leaked AKIAABCDEFGHIJKLMNOP" }, "redact");
		expect(v?.policy).toBe("redact");
		expect(v?.code).toBe("INGRESS_POLICY_VIOLATION");
	});

	it("collects detections across multiple fields", () => {
		try {
			enforceNoSecrets(
				{
					title: "clean",
					summary: "AKIAABCDEFGHIJKLMNOP",
					details: "ghp_0123456789abcdefghijklmnopqrstuvwxyz01",
				},
				"reject",
			);
			expect.fail("should have thrown");
		} catch (e) {
			const err = e as SecretViolationError;
			const fields = err.violation.detections.map((d) => d.field);
			expect(fields).toContain("summary");
			expect(fields).toContain("details");
		}
	});

	it("ignores undefined/null field values", () => {
		expect(
			enforceNoSecrets({ summary: "clean", details: undefined, extra: null }, "reject"),
		).toBeNull();
	});
});
