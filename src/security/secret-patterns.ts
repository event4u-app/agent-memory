/**
 * Versioned catalog of secret / PII / env-value detectors.
 *
 * Every entry is a `SecretPattern`. The scanner in `secret-guard.ts` iterates
 * this list in order — specific patterns come before generic fallbacks so the
 * reported `name` is the most informative one.
 *
 * Adding a new pattern: append an entry with a positive + negative test case
 * in `tests/unit/secret-patterns.test.ts`. `confidence: "medium"` entries are
 * still active but can be neutralised by the allow-list (see roadmap II4).
 */

import type { SecretDetectionCode } from "./secret-violation.js";

export type SecretConfidence = "high" | "medium";

export interface SecretPattern {
	/** Canonical id — stable across releases, used as detection `pattern`. */
	name: string;
	/** Group bucket for docs/UI (e.g. "github", "aws", "generic"). */
	provider: string;
	/** Detection category. */
	code: SecretDetectionCode;
	/** Confidence in the match being a real secret/PII. */
	confidence: SecretConfidence;
	/** Match expression. MUST have the `g` flag. */
	regex: RegExp;
	/** Short prose for humans + doc generator. */
	description: string;
	/** Known false-positive contexts (e.g. "test fixtures", "lorem text"). */
	falsePositiveHints?: string[];
}

/** Catalog version — bump on any shape or semantic change. */
export const CATALOG_VERSION = "1.0.0";

export const SECRET_PATTERNS: SecretPattern[] = [
	// --- Cloud provider tokens (specific, high confidence) ---
	{
		name: "aws_access_key",
		provider: "aws",
		code: "SECRET_DETECTED",
		confidence: "high",
		regex: /AKIA[0-9A-Z]{16}/g,
		description: "AWS access key id (AKIA…).",
	},
	{
		name: "gcp_api_key",
		provider: "gcp",
		code: "SECRET_DETECTED",
		confidence: "high",
		regex: /AIza[0-9A-Za-z_-]{35}/g,
		description: "Google Cloud API key (AIza…).",
	},
	{
		name: "azure_storage_connection_string",
		provider: "azure",
		code: "SECRET_DETECTED",
		confidence: "high",
		regex: /DefaultEndpointsProtocol=[^\s;'"]+;AccountName=[^;]+;AccountKey=[A-Za-z0-9+/=]+/g,
		description: "Azure storage connection string with AccountKey.",
	},

	// --- AI provider tokens ---
	{
		name: "openai_api_key",
		provider: "openai",
		code: "SECRET_DETECTED",
		confidence: "high",
		regex: /sk-(?:proj-)?[A-Za-z0-9_-]{32,}/g,
		description: "OpenAI API key (sk-… or sk-proj-…).",
	},
	{
		name: "anthropic_api_key",
		provider: "anthropic",
		code: "SECRET_DETECTED",
		confidence: "high",
		regex: /sk-ant-[A-Za-z0-9_-]{40,}/g,
		description: "Anthropic API key (sk-ant-…).",
	},

	// --- Payments / messaging ---
	{
		name: "stripe_live_secret_key",
		provider: "stripe",
		code: "SECRET_DETECTED",
		confidence: "high",
		regex: /sk_live_[A-Za-z0-9]{24,}/g,
		description: "Stripe live secret key (sk_live_…).",
	},
	{
		name: "stripe_restricted_key",
		provider: "stripe",
		code: "SECRET_DETECTED",
		confidence: "high",
		regex: /rk_live_[A-Za-z0-9]{24,}/g,
		description: "Stripe restricted key (rk_live_…).",
	},
	{
		name: "stripe_webhook_secret",
		provider: "stripe",
		code: "SECRET_DETECTED",
		confidence: "high",
		regex: /whsec_[A-Za-z0-9]{32,}/g,
		description: "Stripe webhook signing secret (whsec_…).",
	},
	{
		name: "stripe_live_publishable_key",
		provider: "stripe",
		code: "SECRET_DETECTED",
		confidence: "medium",
		regex: /pk_live_[A-Za-z0-9]{24,}/g,
		description:
			"Stripe live publishable key — not secret alone, often leaked alongside the secret key.",
		falsePositiveHints: ["public keys in client bundles"],
	},
	{
		name: "sendgrid_api_key",
		provider: "sendgrid",
		code: "SECRET_DETECTED",
		confidence: "high",
		regex: /SG\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}/g,
		description: "SendGrid API key (SG.xxx.yyy).",
	},
	{
		name: "slack_token",
		provider: "slack",
		code: "SECRET_DETECTED",
		confidence: "high",
		regex: /xox[baprs]-[A-Za-z0-9-]{10,}/g,
		description: "Slack bot/user/app token (xoxb-, xoxp-, xoxa-, xoxr-, xoxs-).",
	},
	{
		name: "twilio_account_sid",
		provider: "twilio",
		code: "SECRET_DETECTED",
		confidence: "medium",
		regex: /AC[0-9a-f]{32}/g,
		description: "Twilio Account SID (AC + 32 hex). Paired with an auth token in leaks.",
		falsePositiveHints: ["UUIDs prefixed with AC"],
	},

	// --- VCS / package hosts ---
	{
		name: "github_token",
		provider: "github",
		code: "SECRET_DETECTED",
		confidence: "high",
		regex: /gh[pousr]_[A-Za-z0-9_]{36,}/g,
		description:
			"GitHub personal access / OAuth / user / server / refresh token (ghp_, gho_, ghu_, ghs_, ghr_).",
	},
	{
		name: "gitlab_personal_token",
		provider: "gitlab",
		code: "SECRET_DETECTED",
		confidence: "high",
		regex: /glpat-[A-Za-z0-9_-]{20,}/g,
		description: "GitLab personal access token (glpat-…).",
	},
	{
		name: "gitlab_deploy_token",
		provider: "gitlab",
		code: "SECRET_DETECTED",
		confidence: "high",
		regex: /gldt-[A-Za-z0-9_-]{20,}/g,
		description: "GitLab deploy token (gldt-…).",
	},
	{
		name: "bitbucket_access_token",
		provider: "bitbucket",
		code: "SECRET_DETECTED",
		confidence: "high",
		regex: /ATCTT3xFfGN0[A-Za-z0-9+/=_-]{32,}/g,
		description: "Bitbucket repository/workspace access token (ATCTT…).",
	},
	{
		name: "npm_token",
		provider: "npm",
		code: "SECRET_DETECTED",
		confidence: "high",
		regex: /npm_[A-Za-z0-9]{36,}/g,
		description: "npm publish/automation token (npm_…).",
	},

	// --- Infra / platform ---
	{
		name: "heroku_api_key",
		provider: "heroku",
		code: "SECRET_DETECTED",
		confidence: "high",
		regex: /HRKU-[A-Za-z0-9_-]{32,}/g,
		description: "Heroku API key (HRKU-…).",
	},
	{
		name: "digitalocean_pat",
		provider: "digitalocean",
		code: "SECRET_DETECTED",
		confidence: "high",
		regex: /dop_v1_[a-f0-9]{64}/g,
		description: "DigitalOcean personal access token (dop_v1_…).",
	},

	// --- Credentials embedded in URLs / JWTs ---
	{
		name: "basic_auth_url",
		provider: "generic",
		code: "SECRET_DETECTED",
		confidence: "high",
		regex: /https?:\/\/[^:@\s/]+:[^@\s/]+@[^\s/'"]+/g,
		description: "Basic auth embedded in a URL (`https://user:pass@host`).",
	},
	{
		name: "jwt",
		provider: "generic",
		code: "SECRET_DETECTED",
		confidence: "high",
		regex: /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g,
		description: "JSON Web Token (three base64url segments).",
	},
	{
		name: "connection_string",
		provider: "generic",
		code: "SECRET_DETECTED",
		confidence: "high",
		regex: /(?:postgres(?:ql)?|mysql|redis|mongodb):\/\/[^\s'"]+/gi,
		description: "Database connection string (postgres://, mysql://, redis://, mongodb://).",
	},

	// --- Private keys ---
	{
		name: "private_key_pem",
		provider: "generic",
		code: "SECRET_DETECTED",
		confidence: "high",
		regex:
			/-----BEGIN (?:RSA |EC |DSA )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |DSA )?PRIVATE KEY-----/g,
		description: "PEM-encoded RSA/EC/DSA/PKCS8 private key.",
	},
	{
		name: "openssh_private_key",
		provider: "openssh",
		code: "SECRET_DETECTED",
		confidence: "high",
		regex: /-----BEGIN OPENSSH PRIVATE KEY-----[\s\S]*?-----END OPENSSH PRIVATE KEY-----/g,
		description: "OpenSSH-format private key.",
	},

	// --- Generic heuristic — medium confidence so the allow-list (II4) can neutralise UUIDs/SHAs. ---
	{
		name: "generic_key_token_secret",
		provider: "generic",
		code: "SECRET_DETECTED",
		confidence: "medium",
		regex:
			/(?:api[_-]?key|token|secret|password|passwd|pwd|auth|bearer)\s*[:=]\s*['"]?[A-Za-z0-9_\-/.+=]{16,}['"]?/gi,
		description: "`api_key=…` / `token=…` / `bearer …` style assignment with a 16+ char value.",
		falsePositiveHints: ["documentation examples", "placeholder values longer than 16 chars"],
	},

	// --- PII + environment variables ---
	{
		name: "email",
		provider: "generic",
		code: "PII_DETECTED",
		confidence: "high",
		regex: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
		description: "Email address.",
	},
	{
		name: "env_var_value",
		provider: "generic",
		code: "ENV_VALUE_DETECTED",
		confidence: "medium",
		regex: /^[A-Z][A-Z0-9_]*\s*=\s*\S.*$/gm,
		description: "Standalone `KEY=value` line that looks like a .env entry.",
		falsePositiveHints: ["shell export snippets", "configuration examples"],
	},
];
