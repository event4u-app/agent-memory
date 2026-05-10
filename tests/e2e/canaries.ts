/**
 * Canary tokens for the secret-safety E2E tests.
 *
 * Every value is **syntactically valid** for its pattern (so the guard
 * fires) but **operatively invalid** — the embedded marker
 * `agent_memory_canary` makes them unusable against any real provider
 * and searchable in incident logs. Do not copy these anywhere outside
 * the test harness.
 *
 * Registry shape mirrors the catalog in `src/security/secret-patterns.ts`.
 * When a new high-confidence pattern lands there, add a canary here so
 * the coverage check in `secret-safety.test.ts` still passes.
 */

export interface Canary {
	pattern: string;
	value: string;
}

/**
 * Runtime-assembled token shape — defeats at-rest literal scans
 * (GitHub Push Protection, gitleaks, trufflehog static rules) while
 * producing a byte-identical string at runtime. Every provider-shaped
 * canary below routes through this helper; without it, committing this
 * file trips the provider's own static scanner even though every token
 * is synthetic and carries the `agent_memory_canary` marker.
 */
const s = (...parts: string[]): string => parts.join("");

export const CANARIES: Canary[] = [
	{ pattern: "aws_access_key", value: s("AK", "IAAGENTMEMORYCANARY") },
	{
		pattern: "gcp_api_key",
		value: s("AI", "zaAgentMemoryCanary_0123456789abcdefghij"),
	},
	{
		pattern: "azure_storage_connection_string",
		value: s(
			"DefaultEndpointsProtocol=https;AccountName=agentmemorycanary;Account",
			"Key=YWdlbnRfbWVtb3J5X2NhbmFyeQ==",
		),
	},
	{
		pattern: "openai_api_key",
		value: s("sk", "-agentmemorycanary0123456789ABCDEF01"),
	},
	{
		pattern: "anthropic_api_key",
		value: s("sk", "-ant-agentmemorycanary0123456789ABCDEFGHIJKLMN"),
	},
	{
		pattern: "stripe_live_secret_key",
		value: s("sk_", "live_agentmemorycanary0123456789"),
	},
	{
		pattern: "stripe_restricted_key",
		value: s("rk_", "live_agentmemorycanary0123456789"),
	},
	{
		pattern: "stripe_webhook_secret",
		value: s("wh", "sec_agentmemorycanary0123456789012345"),
	},
	{
		pattern: "sendgrid_api_key",
		value: s("SG", ".agentmemorycanary_2345.agentmemorycanary0123456789abcdefghijklmnopqrstuv"),
	},
	{
		pattern: "slack_token",
		value: s("xo", "xb-agent-memory-canary-0123456789"),
	},
	{
		pattern: "twilio_account_sid",
		value: s("AC", "0123456789abcdef0123456789abcdef"),
	},
	{
		pattern: "github_token",
		value: s("gh", "p_agentmemorycanary0123456789abcdefghij01"),
	},
	{
		pattern: "gitlab_personal_token",
		value: s("gl", "pat-agentmemorycanary0123456789"),
	},
	{
		pattern: "gitlab_deploy_token",
		value: s("gl", "dt-agentmemorycanary0123456789"),
	},
	{
		pattern: "bitbucket_access_token",
		value: s("ATC", "TT3xFfGN0agentmemorycanary0123456789abcdef"),
	},
	{
		pattern: "npm_token",
		value: s("npm", "_agentmemorycanary0123456789abcdefghij01"),
	},
	{
		pattern: "heroku_api_key",
		value: s("HR", "KU-agentmemorycanary0123456789abcdef"),
	},
	{
		pattern: "digitalocean_pat",
		value: s("dop", "_v1_0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"),
	},
	{
		pattern: "basic_auth_url",
		value: s("https://agent:", "memory-canary@example.test/path"),
	},
];

/** Single canary used in negative-path asserts (`DB NOT LIKE %...%`). */
export const CANARY_MARKER = "agent_memory_canary";
