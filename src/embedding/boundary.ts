/**
 * Embedding ingress boundary.
 *
 * Every text passed to a provider `embed()` flows through `secureEmbeddingInput`
 * first. It applies the active secret policy:
 * - `reject`: throws `SecretViolationError` — no embedding call happens.
 * - `redact`: logs an audit warning and embeds a scrubbed copy of the text.
 *
 * The boundary exists because retrieval queries (MCP/CLI) never go through
 * `PromotionService.propose`, so the service-layer guard would miss them.
 * Placing the guard at the funnel shared by every provider closes that gap.
 */

import {
	redactSecretsInText,
	SecretViolationError,
	scanForSecrets,
} from "../security/secret-guard.js";
import type { SecretPolicy } from "../security/secret-policy.js";
import { createSecretViolation } from "../security/secret-violation.js";
import { logger } from "../utils/logger.js";

/**
 * Scan `text` for secrets and apply the active policy.
 * Returns the text that should actually be sent to the provider — identical
 * to the input when clean, scrubbed under `redact`, never returned under `reject`.
 */
export function secureEmbeddingInput(text: string, policy: SecretPolicy): string {
	const detections = scanForSecrets(text, "embedding");
	if (detections.length === 0) return text;

	const violation = createSecretViolation(detections, policy);
	if (policy === "reject") {
		throw new SecretViolationError(violation);
	}

	logger.warn(
		{
			policy: "redact",
			stage: "embedding-boundary",
			detections: violation.detections.map((d) => ({
				code: d.code,
				pattern: d.pattern,
			})),
		},
		"secret-guard: redacting before embedding",
	);
	return redactSecretsInText(text);
}
