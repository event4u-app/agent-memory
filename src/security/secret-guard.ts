import { config } from "../config.js";
import type {
	MemoryEventRepository,
	SecretEventType,
} from "../db/repositories/memory-event.repository.js";
import { shannonEntropy } from "../ingestion/privacy-filter.js";
import { logger } from "../utils/logger.js";
import { matchAllowList } from "./allowlist.js";
import { SECRET_PATTERNS } from "./secret-patterns.js";
import type { SecretPolicy } from "./secret-policy.js";
import {
	createSecretViolation,
	type SecretDetection,
	type SecretViolation,
} from "./secret-violation.js";

/**
 * Structured secret scanner used by every ingress path (CLI, MCP, services).
 * Produces a list of named detections with byte offsets — never the secret value.
 *
 * The pattern catalog lives in `secret-patterns.ts` and is versioned.
 * Detector parity with `src/ingestion/privacy-filter.ts` is asserted by
 * `tests/unit/secret-guard.test.ts`. Any drift between the two is a bug.
 */

const HIGH_ENTROPY_RE = /['"][A-Za-z0-9+/=_-]{20,}['"]/g;

/**
 * Overrides for the entropy heuristic. Only the eval script and tests should
 * pass these — production callers rely on `config.security.entropy*`.
 */
export interface EntropyOptions {
	threshold?: number;
	minLength?: number;
}

/**
 * Scan a single string for secrets. Returns an empty array when clean.
 * `field` is attached to each detection when provided so agents can see which
 * input triggered the violation.
 *
 * `entropyOptions` lets calibration tooling (see
 * `scripts/eval-entropy-threshold.ts`) sweep thresholds without touching the
 * process config. Production ingress never passes it.
 */
export function scanForSecrets(
	text: string | undefined | null,
	field?: string,
	entropyOptions?: EntropyOptions,
): SecretDetection[] {
	if (!text) return [];
	const detections: SecretDetection[] = [];

	for (const { name, code, regex } of SECRET_PATTERNS) {
		regex.lastIndex = 0;
		const matches = Array.from(text.matchAll(regex));
		if (matches.length === 0) continue;
		detections.push({
			code,
			pattern: name,
			...(field ? { field } : {}),
			offsetRanges: matches.map((m) => ({
				start: m.index ?? 0,
				end: (m.index ?? 0) + m[0].length,
			})),
		});
	}

	const threshold = entropyOptions?.threshold ?? config.security.entropyThreshold;
	const minLength = entropyOptions?.minLength ?? config.security.entropyMinLength;
	const highEntropyRanges: { start: number; end: number }[] = [];
	for (const m of text.matchAll(HIGH_ENTROPY_RE)) {
		const inner = m[0].slice(1, -1);
		if (inner.length < minLength) continue;
		if (shannonEntropy(inner) <= threshold) continue;
		// Named benign shapes (Git SHAs, UUIDs, semver, SRI hashes) are
		// dropped here — see `allowlist.ts` for the full list and the
		// reasoning per entry. Anchored match on the quoted inner only;
		// partial overlap is never enough.
		if (matchAllowList(inner) !== null) continue;
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
	for (const { name, code, regex } of SECRET_PATTERNS) {
		if (code !== "SECRET_DETECTED") continue;
		regex.lastIndex = 0;
		result = result.replace(regex, `[REDACTED:${name}]`);
	}
	return result;
}

/**
 * Audit-path redaction marker. Distinct from `redactSecretsInText` (log path,
 * keeps pattern name) and the retrieval marker (`[REDACTED:retrieve]`, III2)
 * so an operator reading a stored DB value can tell *where* the redaction
 * happened. Also distinct from the ingest-redact policy which uses per-
 * pattern markers at ingress time.
 *
 * Scope mirrors `redactSecretsInText` — only `SECRET_DETECTED` patterns.
 */
export const SECRET_AUDIT_MARKER = "[REDACTED:secret]";

export function redactSecretsForAudit(text: string): { text: string; patterns: Set<string> } {
	let result = text;
	const patterns = new Set<string>();
	for (const { name, code, regex } of SECRET_PATTERNS) {
		if (code !== "SECRET_DETECTED") continue;
		regex.lastIndex = 0;
		if (!regex.test(result)) continue;
		patterns.add(name);
		regex.lastIndex = 0;
		result = result.replace(regex, SECRET_AUDIT_MARKER);
	}
	return { text: result, patterns };
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

/**
 * Context identifying which ingress path produced an event.
 * `ingressPath` matches the `surface` tag from `src/security/ingress-inventory.ts`
 * (mcp_propose, mcp_observe, cli_propose, service_propose, …).
 */
export interface SecretEventContext {
	actor: string;
	ingressPath: string;
	entryId?: string | null;
}

/**
 * Build the audit metadata for a violation. Scope is deliberately narrow —
 * pattern names, ingress_path, policy, and (optional) field names. Offsets,
 * raw values, and hashes are all excluded: the roadmap IV1 scope line
 * "Nie der Secret-Inhalt oder ein Hash davon" is enforced here.
 */
function auditMetadata(
	violation: SecretViolation,
	ctx: SecretEventContext,
): Record<string, unknown> {
	const patterns = Array.from(new Set(violation.detections.map((d) => d.pattern)));
	const fields = Array.from(
		new Set(violation.detections.map((d) => d.field).filter((f): f is string => Boolean(f))),
	);
	const meta: Record<string, unknown> = {
		ingress_path: ctx.ingressPath,
		policy: violation.policy,
		patterns,
	};
	if (fields.length > 0) meta.fields = fields;
	return meta;
}

async function safeRecord(
	recorder: MemoryEventRepository | undefined,
	input: {
		entryId?: string | null;
		actor: string;
		eventType: SecretEventType;
		metadata?: Record<string, unknown>;
	},
): Promise<void> {
	if (!recorder) return;
	try {
		await recorder.record(input);
	} catch (err) {
		// Audit write failure is a monitoring concern — do not mask the
		// successful reject/redact by throwing a different error here.
		logger.error(
			{ err: err instanceof Error ? err.message : String(err), eventType: input.eventType },
			"secret-guard: audit event write failed",
		);
	}
}

/**
 * `enforceNoSecrets` + persistent audit emission. When `recorder` is undefined
 * the behavior is identical to `enforceNoSecrets` — that keeps unit tests that
 * don't care about events simple while every production ingress wires the
 * real repository (see `src/security/ingress-inventory.ts`).
 *
 * Reject path → emits `secret_rejected` then re-throws.
 * Redact path → emits `secret_redacted` then returns the violation.
 * Clean path → no event.
 */
export async function enforceNoSecretsWithAudit(
	fields: Record<string, string | undefined | null>,
	policy: SecretPolicy,
	ctx: SecretEventContext,
	recorder: MemoryEventRepository | undefined,
): Promise<SecretViolation | null> {
	try {
		const violation = enforceNoSecrets(fields, policy);
		if (violation) {
			await safeRecord(recorder, {
				entryId: ctx.entryId ?? null,
				actor: ctx.actor,
				eventType: "secret_redacted",
				metadata: auditMetadata(violation, ctx),
			});
		}
		return violation;
	} catch (err) {
		if (err instanceof SecretViolationError) {
			await safeRecord(recorder, {
				entryId: ctx.entryId ?? null,
				actor: ctx.actor,
				eventType: "secret_rejected",
				metadata: auditMetadata(err.violation, ctx),
			});
		}
		throw err;
	}
}
