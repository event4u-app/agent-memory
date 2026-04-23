import { shannonEntropy } from "../ingestion/privacy-filter.js";
import type { SecretPolicy } from "./secret-policy.js";
import {
	createSecretViolation,
	type SecretDetection,
	type SecretDetectionCode,
	type SecretViolation,
} from "./secret-violation.js";

/**
 * Structured secret scanner used by every ingress path (CLI, MCP, services).
 * Produces a list of named detections with byte offsets — never the secret value.
 *
 * Detector parity with `src/ingestion/privacy-filter.ts` is asserted by
 * `tests/unit/secret-guard.test.ts`. Any drift between the two is a bug.
 */

interface NamedPattern {
	pattern: string;
	code: SecretDetectionCode;
	re: RegExp;
}

// Order matters: specific patterns before the generic fallback so the
// reported `pattern` is the most informative one.
const NAMED_PATTERNS: NamedPattern[] = [
	{ pattern: "aws_access_key", code: "SECRET_DETECTED", re: /AKIA[0-9A-Z]{16}/g },
	{
		pattern: "jwt",
		code: "SECRET_DETECTED",
		re: /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g,
	},
	{
		pattern: "connection_string",
		code: "SECRET_DETECTED",
		re: /(?:postgres(?:ql)?|mysql|redis|mongodb):\/\/[^\s'"]+/gi,
	},
	{
		pattern: "private_key",
		code: "SECRET_DETECTED",
		re: /-----BEGIN (?:RSA |EC |DSA )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |DSA )?PRIVATE KEY-----/g,
	},
	{ pattern: "github_token", code: "SECRET_DETECTED", re: /gh[ps]_[A-Za-z0-9_]{36,}/g },
	{ pattern: "npm_token", code: "SECRET_DETECTED", re: /npm_[A-Za-z0-9]{36,}/g },
	{
		pattern: "generic_key_token_secret",
		code: "SECRET_DETECTED",
		re: /(?:api[_-]?key|token|secret|password|passwd|pwd|auth|bearer)\s*[:=]\s*['"]?[A-Za-z0-9_\-/.+=]{16,}['"]?/gi,
	},
	{
		pattern: "email",
		code: "PII_DETECTED",
		re: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
	},
	{
		pattern: "env_var_value",
		code: "ENV_VALUE_DETECTED",
		re: /^[A-Z][A-Z0-9_]*\s*=\s*\S.*$/gm,
	},
];

const HIGH_ENTROPY_RE = /['"][A-Za-z0-9+/=_-]{20,}['"]/g;
const HIGH_ENTROPY_THRESHOLD = 4.0;
const HIGH_ENTROPY_MIN_LENGTH = 20;

/**
 * Scan a single string for secrets. Returns an empty array when clean.
 * `field` is attached to each detection when provided so agents can see which
 * input triggered the violation.
 */
export function scanForSecrets(text: string | undefined | null, field?: string): SecretDetection[] {
	if (!text) return [];
	const detections: SecretDetection[] = [];

	for (const { pattern, code, re } of NAMED_PATTERNS) {
		re.lastIndex = 0;
		const matches = Array.from(text.matchAll(re));
		if (matches.length === 0) continue;
		detections.push({
			code,
			pattern,
			...(field ? { field } : {}),
			offsetRanges: matches.map((m) => ({
				start: m.index ?? 0,
				end: (m.index ?? 0) + m[0].length,
			})),
		});
	}

	const highEntropyRanges: { start: number; end: number }[] = [];
	for (const m of text.matchAll(HIGH_ENTROPY_RE)) {
		const inner = m[0].slice(1, -1);
		if (inner.length < HIGH_ENTROPY_MIN_LENGTH) continue;
		if (shannonEntropy(inner) <= HIGH_ENTROPY_THRESHOLD) continue;
		const start = m.index ?? 0;
		highEntropyRanges.push({ start, end: start + m[0].length });
	}
	if (highEntropyRanges.length > 0) {
		detections.push({
			code: "HIGH_ENTROPY_DETECTED",
			pattern: "high_entropy",
			...(field ? { field } : {}),
			offsetRanges: highEntropyRanges,
		});
	}

	return detections;
}

/**
 * Replace secret matches in `text` with `[REDACTED:pattern]` markers.
 * Scope is intentionally narrower than `scanForSecrets`: only patterns with
 * code `SECRET_DETECTED` fire here. PII, env-values, and high-entropy
 * heuristics are excluded because they cause excessive churn in log output
 * where the signal-to-noise ratio matters.
 */
export function redactSecretsInText(text: string): string {
	let result = text;
	for (const { pattern, code, re } of NAMED_PATTERNS) {
		if (code !== "SECRET_DETECTED") continue;
		re.lastIndex = 0;
		result = result.replace(re, `[REDACTED:${pattern}]`);
	}
	return result;
}

/**
 * Scan a structured record (fieldName → text). Each field is scanned
 * independently so detections report their originating field.
 */
export function scanFields(fields: Record<string, string | undefined | null>): SecretDetection[] {
	const all: SecretDetection[] = [];
	for (const [field, value] of Object.entries(fields)) {
		all.push(...scanForSecrets(value, field));
	}
	return all;
}

/**
 * Thrown by ingress paths when policy = reject and detections are non-empty.
 * `.violation` carries the contract-locked envelope for direct serialization.
 */
export class SecretViolationError extends Error {
	readonly violation: SecretViolation;
	constructor(violation: SecretViolation) {
		super(`INGRESS_POLICY_VIOLATION: ${violation.detections.length} detection(s)`);
		this.name = "SecretViolationError";
		this.violation = violation;
	}
}

/**
 * Enforce the active secret policy over a set of input fields.
 * - `reject` (default): throws `SecretViolationError` if any detection fires.
 * - `redact`: returns the violation for audit purposes but does not throw.
 *
 * Returns `null` when the input is clean.
 */
export function enforceNoSecrets(
	fields: Record<string, string | undefined | null>,
	policy: SecretPolicy,
): SecretViolation | null {
	const detections = scanFields(fields);
	if (detections.length === 0) return null;
	const violation = createSecretViolation(detections, policy);
	if (policy === "reject") {
		throw new SecretViolationError(violation);
	}
	return violation;
}
