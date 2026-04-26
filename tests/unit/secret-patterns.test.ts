import { describe, expect, it } from "vitest";
import { scanForSecrets } from "../../src/security/secret-guard.js";
import { CATALOG_VERSION, SECRET_PATTERNS } from "../../src/security/secret-patterns.js";

/**
 * Per-pattern positive + negative coverage for the centralized catalog.
 *
 * Each entry provides a matching sample (positive) and a near-miss the
 * pattern must NOT claim. Generic heuristics (`generic_key_token_secret`,
 * `high_entropy`, `env_var_value`, `email`) are covered in
 * `secret-guard.test.ts` because their negatives depend on context, not
 * on specific provider shapes.
 */

interface Case {
	name: string;
	positive: string;
	negative: string;
}

/**
 * Runtime-assembled token shape — defeats at-rest literal scans
 * (GitHub Push Protection, gitleaks, trufflehog static rules) while
 * producing a byte-identical string at runtime. Every provider-shaped
 * fixture below routes through this helper.
 */
const s = (...parts: string[]): string => parts.join("");

const CASES: Case[] = [
	{
		name: "aws_access_key",
		positive: s("AK", "IAABCDEFGHIJKLMNOP"),
		negative: s("AK", "IA_TOO_SHORT"),
	},
	{
		name: "gcp_api_key",
		positive: s("AI", "zaSyAbCdEfGhIjKlMnOpQrStUvWxYz0123456"),
		negative: s("AI", "zaTooShort"),
	},
	{
		name: "azure_storage_connection_string",
		positive: s(
			"DefaultEndpointsProtocol=https;AccountName=foo;Account",
			"Key=YWJjZGVmZ2hpamtsbW5vcA==",
		),
		negative: "DefaultEndpointsProtocol=https;AccountName=foo", // missing AccountKey
	},
	{
		name: "openai_api_key",
		positive: s("sk", "-abcdefghijklmnopqrstuvwxyzABCDEF01"),
		negative: s("sk", "-short"),
	},
	{
		name: "anthropic_api_key",
		positive: s("sk", "-ant-abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMN"),
		negative: s("sk", "-ant-short"),
	},
	{
		name: "stripe_live_secret_key",
		positive: s("sk_", "live_0123456789abcdefghijkLMN"),
		negative: s("sk_", "test_0123456789abcdefghijkLMN"),
	},
	{
		name: "stripe_restricted_key",
		positive: s("rk_", "live_0123456789abcdefghijkLMN"),
		negative: s("rk_", "test_0123456789abcdefghijkLMN"),
	},
	{
		name: "stripe_webhook_secret",
		positive: s("wh", "sec_0123456789abcdefghijklmnopqrstuvwx"),
		negative: s("wh", "sec_short"),
	},
	{
		name: "stripe_live_publishable_key",
		positive: s("pk_", "live_0123456789abcdefghijkLMN"),
		negative: s("pk_", "test_0123456789abcdefghijkLMN"),
	},
	{
		name: "sendgrid_api_key",
		positive: s("SG", ".abcdefghijklmnopqrstuv.abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUV"),
		negative: "SG.too.short",
	},
	{
		name: "slack_token",
		positive: s("xo", "xb-123456789012-ABCDEFGHIJ0123456789"),
		negative: s("xo", "xz-123456789012-ABCDEFGHIJ0123456789"),
	},
	{
		name: "twilio_account_sid",
		positive: s("AC", "0123456789abcdef0123456789abcdef"),
		negative: s("AC", "0123456789"), // too short
	},
	{
		name: "github_token",
		positive: s("gh", "p_0123456789abcdefghijklmnopqrstuvwxyz01"),
		negative: s("gh", "_0123456789abcdefghijklmnopqrstuvwxyz01"),
	},
	{
		name: "gitlab_personal_token",
		positive: s("gl", "pat-0123456789abcdefghij"),
		negative: s("gl", "pat-short"),
	},
	{
		name: "gitlab_deploy_token",
		positive: s("gl", "dt-0123456789abcdefghij"),
		negative: s("gl", "dt-short"),
	},
	{
		name: "bitbucket_access_token",
		positive: s("ATC", "TT3xFfGN00123456789abcdefghijklmnopqrstuv"),
		negative: s("ATC", "TT3xFfGN0short"),
	},
	{
		name: "npm_token",
		positive: s("npm", "_0123456789abcdefghijklmnopqrstuvwxyz01"),
		negative: s("npm", "_short"),
	},
	{
		name: "heroku_api_key",
		positive: s("HR", "KU-0123456789abcdefghijklmnopqrstuv"),
		negative: s("HR", "KU-short"),
	},
	{
		name: "digitalocean_pat",
		positive: s("dop", "_v1_0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"),
		negative: s("dop", "_v1_tooshort"),
	},
	{
		name: "basic_auth_url",
		positive: s("https://alice:", "s3cret@example.com/path"),
		negative: "https://example.com/path",
	},
];

describe("SECRET_PATTERNS catalog", () => {
	it("exports a non-empty versioned catalog", () => {
		expect(CATALOG_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
		expect(SECRET_PATTERNS.length).toBeGreaterThan(10);
	});

	it("every regex has the `g` flag", () => {
		for (const p of SECRET_PATTERNS) {
			expect(p.regex.flags, `${p.name} missing g flag`).toContain("g");
		}
	});

	it("pattern names are unique", () => {
		const names = SECRET_PATTERNS.map((p) => p.name);
		expect(new Set(names).size).toBe(names.length);
	});
});

describe("SECRET_PATTERNS — per-provider coverage", () => {
	for (const c of CASES) {
		it(`${c.name}: detects the positive sample`, () => {
			const d = scanForSecrets(c.positive);
			expect(d.map((x) => x.pattern)).toContain(c.name);
		});

		it(`${c.name}: does not match the near-miss negative sample`, () => {
			const d = scanForSecrets(c.negative);
			expect(d.map((x) => x.pattern)).not.toContain(c.name);
		});
	}
});
