import { describe, expect, it } from "vitest";
import { applyPrivacyFilter } from "../../src/ingestion/privacy-filter.js";

/**
 * Privacy audit tests — verify that no sensitive data can leak through any code path.
 * These are integration-style tests that simulate realistic input.
 */
describe("Privacy Audit", () => {
	const sensitivePatterns = [
		// API keys
		'api_key: "sk-abc123456789abcdef1234567890"',
		"OPENAI_API_KEY=sk-proj-abc123456789abcdef",
		"Authorization: Bearer ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij",
		// Connection strings
		"DATABASE_URL=postgres://admin:s3cret@db.example.com:5432/mydb",
		"REDIS_URL=redis://:password@redis.example.com:6379",
		// Private keys
		"-----BEGIN RSA PRIVATE KEY-----\nMIIEpAIBAAKCAQ...\n-----END RSA PRIVATE KEY-----",
		// AWS keys
		"aws_access_key_id=AKIAIOSFODNN7EXAMPLE",
		// JWT tokens
		"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U",
		// Email addresses
		"user@example.com",
		"admin.team@company.co.uk",
		// Env variables
		"DB_PASSWORD=supersecretpassword123\nAPP_KEY=base64:longrandomstring",
		// Private tags
		"<private>this should never appear in output</private>",
		// npm tokens
		"npm_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmno",
	];

	for (const sensitive of sensitivePatterns) {
		it(`redacts: ${sensitive.slice(0, 50)}...`, () => {
			const input = `Some context around ${sensitive} in a memory entry`;
			const result = applyPrivacyFilter(input);
			// The original sensitive value should not appear in output
			// (It's OK if [REDACTED:...] appears — that's expected)
			const sensitiveCore = extractCore(sensitive);
			if (sensitiveCore) {
				expect(result).not.toContain(sensitiveCore);
			}
			expect(result).toContain("[REDACTED:");
		});
	}

	it("preserves non-sensitive content", () => {
		const input =
			"The architecture decision was to use PostgreSQL for persistence. The module structure follows hexagonal architecture.";
		const result = applyPrivacyFilter(input);
		expect(result).toBe(input);
	});

	it("handles mixed sensitive and non-sensitive content", () => {
		const input =
			'Use the api_key="sk-proj-abc123456789abcdef1234567890" to connect. The endpoint is /api/v1/memories.';
		const result = applyPrivacyFilter(input);
		expect(result).toContain("/api/v1/memories");
		expect(result).toContain("[REDACTED:");
		expect(result).not.toContain("sk-proj-abc");
	});

	it("does not over-redact short strings", () => {
		const input = "The config key is 'port' and value is '5432'";
		const result = applyPrivacyFilter(input);
		expect(result).toContain("port");
		expect(result).toContain("5432");
	});
});

describe("Access Scope Validation", async () => {
	const { validateScope, canAccess, filterByScope } = await import(
		"../../src/security/access-scope.js"
	);

	it("rejects empty repository", () => {
		const result = validateScope({
			repository: "",
			files: [],
			symbols: [],
			modules: [],
		});
		expect(result.valid).toBe(false);
		expect(result.errors).toContain("repository is required");
	});

	it("rejects absolute file paths", () => {
		const result = validateScope({
			repository: "test",
			files: ["/etc/passwd"],
			symbols: [],
			modules: [],
		});
		expect(result.valid).toBe(false);
	});

	it("rejects path traversal", () => {
		const result = validateScope({
			repository: "test",
			files: ["../../secret.txt"],
			symbols: [],
			modules: [],
		});
		expect(result.valid).toBe(false);
	});

	it("accepts valid scope", () => {
		const result = validateScope({
			repository: "my-repo",
			files: ["src/index.ts"],
			symbols: ["MyClass"],
			modules: ["core"],
		});
		expect(result.valid).toBe(true);
		expect(result.errors).toHaveLength(0);
	});

	it("enforces repository isolation", () => {
		const scope = { repository: "repo-a", callerId: "agent" };
		expect(canAccess(scope, "repo-a")).toBe(true);
		expect(canAccess(scope, "repo-b")).toBe(false);
	});

	it("filters entries by scope", () => {
		const scope = { repository: "repo-a", callerId: "agent" };
		const entries = [
			{ id: "1", scope: { repository: "repo-a" } },
			{ id: "2", scope: { repository: "repo-b" } },
			{ id: "3", scope: { repository: "repo-a" } },
		];
		const filtered = filterByScope(entries, scope);
		expect(filtered).toHaveLength(2);
		expect(filtered.map((e) => e.id)).toEqual(["1", "3"]);
	});
});

/**
 * Extract the "core" sensitive part that should never appear in output.
 * Skips the pattern prefix (like "api_key:") and gets the actual secret value.
 */
function extractCore(sensitive: string): string | null {
	// For env lines, get the value part
	if (sensitive.includes("=") && /^[A-Z]/.test(sensitive)) {
		const val = sensitive.split("=")[1]?.split("\n")[0];
		return val && val.length > 10 ? val : null;
	}
	// For private tags, get the content
	const privateMatch = sensitive.match(/<private>(.*?)<\/private>/);
	if (privateMatch) return privateMatch[1] ?? null;
	// For emails
	if (sensitive.includes("@") && !sensitive.includes("://")) return sensitive;
	// For connection strings, get the password
	const connMatch = sensitive.match(/:\/\/.*:(.*?)@/);
	if (connMatch) return connMatch[1] ?? null;
	return null;
}
