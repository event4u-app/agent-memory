import { describe, expect, it } from "vitest";
import { shannonEntropy } from "../../src/ingestion/privacy-filter.js";
import { ALLOW_PATTERNS, matchAllowList } from "../../src/security/allowlist.js";
import { scanForSecrets } from "../../src/security/secret-guard.js";

/**
 * Unit coverage for the entropy-heuristic allow-list (II4).
 *
 * Every allow-pattern must satisfy two invariants:
 *   1. A representative sample has enough entropy that the heuristic
 *      would otherwise flag it — otherwise the allow-list is a no-op
 *      for that shape and should be deleted.
 *   2. `scanForSecrets` does NOT flag the same sample as `high_entropy`
 *      when embedded in a quoted literal. Catalog patterns may still
 *      match, but the residual heuristic must stay silent.
 *
 * Per-pattern cases are enumerated explicitly — no table-driven magic —
 * so a reviewer sees exactly what each entry is allowed to do.
 */

interface Case {
	name: string;
	positive: string;
	negative: string;
}

const CASES: Case[] = [
	{
		name: "GIT_SHA_40",
		positive: "a1b2c3d4e5f6789012345678901234567890abcd",
		negative: "A1B2C3D4E5F6789012345678901234567890ABCD", // uppercase rejected
	},
	{
		name: "UUID_V4",
		positive: "f47ac10b-58cc-4372-a567-0e02b2c3d479",
		negative: "f47ac10b-58cc-0372-a567-0e02b2c3d479", // version 0 not in 1–5
	},
	{
		name: "SEMVER",
		positive: "v12.345.6789-alpha.1+build.42",
		negative: "1.2", // missing patch
	},
	{
		name: "SRI_HASH",
		positive: "sha512-aBcDeFgHiJkLmNoPqRsTuVwXyZ1234567890abcdefghijklmnopqrstuvwxyz0123",
		negative: "sha128-abcdef", // unsupported algorithm
	},
];

describe("allowlist", () => {
	it("catalog has the expected, minimal set of patterns", () => {
		// The roadmap lists GIT_SHA_40, UUID_V4, SEMVER, SRI_HASH.
		// If this count changes, the allow-list is either growing (needs
		// review) or shrinking (needs a regression rationale).
		expect(ALLOW_PATTERNS.map((p) => p.name)).toEqual([
			"GIT_SHA_40",
			"UUID_V4",
			"SEMVER",
			"SRI_HASH",
		]);
	});

	for (const c of CASES) {
		describe(c.name, () => {
			it("is a plausible heuristic match (length + non-trivial entropy)", () => {
				// Length guard matches production (min 20). Entropy only
				// needs to exceed 3.5 — the lowest reasonable threshold
				// in the calibration matrix — so the allow-list entry is
				// justified against future threshold-lowering. Exact
				// entropy per shape is in docs/security/entropy-calibration.md.
				expect(c.positive.length).toBeGreaterThanOrEqual(20);
				expect(shannonEntropy(c.positive)).toBeGreaterThan(3.5);
			});

			it("matches the allow-list", () => {
				expect(matchAllowList(c.positive)).toBe(c.name);
			});

			it("suppresses the HIGH_ENTROPY_DETECTED detection in scanForSecrets", () => {
				const input = `version = "${c.positive}"`;
				const det = scanForSecrets(input);
				expect(det.find((d) => d.pattern === "high_entropy")).toBeUndefined();
			});

			it("rejects the near-miss negative", () => {
				expect(matchAllowList(c.negative)).toBeNull();
			});
		});
	}

	it("partial overlap is never allow-listed", () => {
		// A UUID embedded in a longer random blob is still suspicious.
		const blob = "f47ac10b-58cc-4372-a567-0e02b2c3d479RANDOMCANARY0123456";
		expect(matchAllowList(blob)).toBeNull();
	});

	it("does not neutralize catalog patterns", () => {
		// An SRI-shaped wrapper around a GitHub token must still fire
		// the catalog detection — allow-list only affects the residual
		// entropy heuristic.
		const input = `"ghp_${"a".repeat(36)}"`;
		const det = scanForSecrets(input);
		expect(det.some((d) => d.pattern === "github_token")).toBe(true);
	});
});
