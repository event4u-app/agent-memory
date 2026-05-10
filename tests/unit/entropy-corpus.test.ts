import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { scanForSecrets } from "../../src/security/secret-guard.js";

/**
 * Corpus-level regression gate for the entropy heuristic + allow-list
 * (II4 Done criterion).
 *
 * Scope of this file is the **residual** detector only — the
 * `HIGH_ENTROPY_DETECTED` heuristic plus the allow-list that filters
 * its output. Named catalog patterns (`secret-patterns.ts`) are covered
 * in `secret-patterns.test.ts` and are intentionally not asserted here,
 * because a corpus line that *also* matches a catalog pattern is fine:
 * the catalog is always the stronger claim.
 *
 * Invariants:
 *
 *   1. Every line in `non-secrets.txt` does NOT trigger the residual
 *      heuristic. The allow-list suppresses Git SHAs, UUIDs, semver
 *      tags, and SRI hashes; catalog over-triggers (e.g. a postgres
 *      URI catches on `db_connection_uri`) are acceptable because
 *      that's a real secret class, not an allow-list gap.
 *   2. Every line in `residual-fps.txt` STILL triggers the residual
 *      heuristic. We document these as structural limitations of a
 *      zero-decoding guard and refuse to paper over them with unsafe
 *      allow-list entries (e.g. unbounded base64).
 *
 * Secret-recall is tracked separately by the calibration matrix in
 * `docs/security/entropy-calibration.md`; it's a tunable metric, not a
 * hard gate.
 */

const CORPUS_DIR = resolve(process.cwd(), "tests/fixtures/entropy-corpus");

function readCorpus(file: string): string[] {
	return readFileSync(resolve(CORPUS_DIR, file), "utf8")
		.split(/\r?\n/)
		.map((l) => l.trim())
		.filter((l) => l.length > 0 && !l.startsWith("#"));
}

function isHighEntropyFlagged(line: string): boolean {
	const det = scanForSecrets(`"${line}"`);
	return det.some((d) => d.pattern === "high_entropy");
}

describe("entropy corpus (II4 regression gate)", () => {
	const nonSecrets = readCorpus("non-secrets.txt");
	const residuals = readCorpus("residual-fps.txt");

	it("non-secrets corpus is non-trivial", () => {
		expect(nonSecrets.length).toBeGreaterThanOrEqual(100);
	});

	it("residual-FP corpus is populated", () => {
		expect(residuals.length).toBeGreaterThan(0);
	});

	it("every non-secret passes the residual heuristic (allow-list does its job)", () => {
		const offenders: string[] = [];
		for (const line of nonSecrets) {
			if (isHighEntropyFlagged(line)) offenders.push(line);
		}
		expect(
			offenders,
			`non-secrets that still trigger high_entropy:\n${offenders.join("\n")}`,
		).toEqual([]);
	});

	it("documented residual FPs remain flagged (we do not paper them over)", () => {
		const silenced: string[] = [];
		for (const line of residuals) {
			if (!isHighEntropyFlagged(line)) silenced.push(line);
		}
		expect(
			silenced,
			`residual FPs that stopped firing — allow-list drifted too far:\n${silenced.join("\n")}`,
		).toEqual([]);
	});
});
