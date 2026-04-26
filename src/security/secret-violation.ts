import type { SecretPolicy } from "./secret-policy.js";

/**
 * High-level category for a single detection. Pattern-level detail lives in
 * `pattern`. Keep this list intentionally small — adding a new code is a
 * contract-level change (secret-violation-v1.schema.json + CHANGELOG).
 */
export type SecretDetectionCode =
	| "SECRET_DETECTED"
	| "PII_DETECTED"
	| "ENV_VALUE_DETECTED"
	| "HIGH_ENTROPY_DETECTED";

export interface SecretOffsetRange {
	start: number;
	end: number;
}

export interface SecretDetection {
	code: SecretDetectionCode;
	/** Canonical pattern name (e.g. `github_token`). Never the regex body. */
	pattern: string;
	/** Input field that triggered the detection, if the caller passes structured input. */
	field?: string;
	/** Byte offsets into the original field. The secret content itself is never included. */
	offsetRanges?: SecretOffsetRange[];
}

/**
 * Structured error envelope shared by CLI (exit code 3) and MCP
 * (`INGRESS_POLICY_VIOLATION`). Agents parse this to decide how to rephrase.
 * Shape is contract-locked: `secret-violation-v1.schema.json`.
 */
export interface SecretViolation {
	code: "INGRESS_POLICY_VIOLATION";
	policy: SecretPolicy;
	detections: SecretDetection[];
	suggestion: string;
}

const DEFAULT_SUGGESTION =
	// biome-ignore lint/suspicious/noTemplateCurlyInString: documentation example, not a template
	"Replace the detected value with a named reference (e.g. ${GITHUB_TOKEN}) " +
	"or a description of the secret's purpose before retrying.";

/**
 * Build a `SecretViolation` from a non-empty list of detections.
 * Throws if `detections` is empty — an empty violation has no meaning.
 */
export function createSecretViolation(
	detections: SecretDetection[],
	policy: SecretPolicy,
	suggestion: string = DEFAULT_SUGGESTION,
): SecretViolation {
	if (detections.length === 0) {
		throw new Error("createSecretViolation requires at least one detection");
	}
	return {
		code: "INGRESS_POLICY_VIOLATION",
		policy,
		detections,
		suggestion,
	};
}

/**
 * Exit code used by CLI commands that reject ingress because of a secret.
 * Separate from generic failure (1) and usage error (2) so scripts can branch.
 */
export const SECRET_VIOLATION_EXIT_CODE = 3;
