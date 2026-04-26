/**
 * Named allow-list for the residual entropy heuristic.
 *
 * The secret-pattern catalog (`secret-patterns.ts`) is the primary
 * defense. Anything that matches a named pattern is always a secret.
 * The `HIGH_ENTROPY_DETECTED` heuristic in `secret-guard.ts` then scans
 * for *un-catalogued* high-entropy strings — this is the layer that
 * produces the false positives operators feel: Git SHAs, UUIDs,
 * semver tags, SRI hashes.
 *
 * This module holds the small, conservative list of shapes we trust to
 * be benign even when their entropy is high. A string is allow-listed
 * only when its **entire** content matches one of these patterns
 * (anchored ^…$). Partial matches are never allow-listed — a UUID
 * embedded in a larger random blob is still suspicious.
 *
 * Contract:
 *   - Patterns are named so the calibration report and audit logs can
 *     say *why* a match was dropped.
 *   - Adding a pattern requires a regression test in
 *     `tests/unit/allowlist.test.ts` that demonstrates the shape is
 *     (a) high-entropy enough to trigger the heuristic and
 *     (b) genuinely not a secret.
 *   - The list is short on purpose. Every entry is a tiny erosion of
 *     the "reject by default" posture; justify each one.
 */

export interface AllowPattern {
	readonly name: string;
	readonly regex: RegExp;
	readonly note: string;
}

export const ALLOW_PATTERNS: readonly AllowPattern[] = [
	{
		name: "GIT_SHA_40",
		// Lowercase hex, exactly 40 chars — the git-commit shape.
		regex: /^[a-f0-9]{40}$/,
		note: "Full Git commit SHA-1.",
	},
	{
		name: "UUID_V4",
		// RFC 4122 v4 (random) UUID. v1/v3/v5 share the same shape but
		// their version nibble differs; we accept any version since the
		// structural shape is what's distinctive, not the version bits.
		regex: /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
		note: "RFC 4122 UUID (versions 1–5).",
	},
	{
		name: "SEMVER",
		// Semver 2.0 with optional v-prefix, pre-release and build metadata.
		// Pre-release + build parts are intentionally narrow (alnum + . + -)
		// to avoid turning this into a catch-all for hyphenated tokens.
		regex: /^v?\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/,
		note: "Semantic Version 2.0 string.",
	},
	{
		name: "SRI_HASH",
		// Subresource Integrity / npm integrity field. Locked to the
		// three algorithms npm supports so arbitrary `prefix-<b64>` shapes
		// don't slip through.
		regex: /^sha(?:256|384|512)-[A-Za-z0-9+/]+={0,2}$/,
		note: "Subresource Integrity hash (npm lockfiles, HTML SRI).",
	},
];

/**
 * Returns the matching allow-pattern name if `inner` is fully covered
 * by any named benign shape, or `null` otherwise.
 *
 * `inner` is the un-quoted content of a quoted literal — the entropy
 * heuristic in `secret-guard.ts` has already stripped the surrounding
 * quotes before calling this.
 */
export function matchAllowList(inner: string): string | null {
	for (const { name, regex } of ALLOW_PATTERNS) {
		if (regex.test(inner)) return name;
	}
	return null;
}
