import { env } from "node:process";

/**
 * How ingress paths react when a secret is detected.
 * - `reject` (default): caller receives a structured `SecretViolation` error and no
 *   side effect occurs (no DB write, no embedding call, no log line).
 * - `redact`: the detected value is replaced with a marker; the original intent
 *   proceeds. An audit event is still emitted so the opt-out stays visible.
 */
export type SecretPolicy = "reject" | "redact";

export const DEFAULT_SECRET_POLICY: SecretPolicy = "reject";

/**
 * Resolve the effective secret policy from environment.
 * Unknown or malformed values fall back to the reject default — silent downgrades
 * to redact would defeat the purpose of reject-by-default.
 */
export function resolveSecretPolicy(value?: string): SecretPolicy {
	const raw = (value ?? env.MEMORY_SECRET_POLICY ?? "").trim().toLowerCase();
	if (raw === "redact") return "redact";
	return DEFAULT_SECRET_POLICY;
}
