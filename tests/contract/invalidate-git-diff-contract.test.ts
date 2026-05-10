// C3 · runtime-trust — contract test for `memory invalidate --from-git-diff`.
//
// Pins the JSON shape emitted by `buildInvalidateGitDiffEnvelope`
// (invalidate-git-diff-v1). `additionalProperties: false` end-to-end;
// drift on either side of the renderer ↔ CLI boundary fails early.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import Ajv from "ajv";
import addFormats from "ajv-formats";
import { describe, expect, it } from "vitest";

import {
	buildInvalidateGitDiffEnvelope,
	type InvalidateGitDiffEnvelope,
} from "../../src/invalidation/git-diff-envelope.js";
import type { InvalidationRunResult } from "../../src/invalidation/orchestrator.js";

const FIXTURE_DIR = join(process.cwd(), "tests/fixtures/retrieval");

function load<T = unknown>(file: string): T {
	return JSON.parse(readFileSync(join(FIXTURE_DIR, file), "utf-8")) as T;
}

const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);
const schema = load("invalidate-git-diff-v1.schema.json");
const validate = ajv.compile(schema);

function assertValid(label: string, ok: boolean, errors: unknown): void {
	if (!ok) {
		throw new Error(
			`invalidate-git-diff-v1 validation failed for ${label}: ${JSON.stringify(errors, null, 2)}`,
		);
	}
}

function sampleResult(): InvalidationRunResult {
	return {
		diff: { filesChanged: 3, fromRef: "origin/main", toRef: "HEAD" },
		watchMatches: 2,
		softInvalidated: 1,
		hardInvalidated: 1,
		driftDetected: 0,
		skipped: 0,
		entries: [
			{
				id: "e1",
				title: "Entry 1",
				action: "soft_invalidate",
				reason: "Minor changes in watched files",
				trigger: "file",
			},
			{
				id: "e2",
				title: "Entry 2",
				action: "hard_invalidate",
				reason: "Watched file deleted: src/foo.ts",
				trigger: "file_deleted",
			},
		],
	};
}

describe("invalidate-git-diff contract v1 — schema conformance", () => {
	it("golden-invalidate-git-diff.json validates against the schema", () => {
		const golden = load<InvalidateGitDiffEnvelope>("golden-invalidate-git-diff.json");
		assertValid("golden", validate(golden), validate.errors);
	});

	it("live buildInvalidateGitDiffEnvelope output validates (scoped)", () => {
		const envelope = buildInvalidateGitDiffEnvelope({
			result: sampleResult(),
			repository: "acme/checkout",
		});
		assertValid("live-scoped", validate(envelope), validate.errors);
		expect(envelope.repository).toBe("acme/checkout");
		expect(envelope.contract_version).toBe("invalidate-git-diff-v1");
	});

	it("live output validates when repository is null (global scope)", () => {
		const envelope = buildInvalidateGitDiffEnvelope({
			result: sampleResult(),
			repository: null,
		});
		assertValid("live-global", validate(envelope), validate.errors);
		expect(envelope.repository).toBeNull();
	});

	it("empty run (no diff) validates with zero counts", () => {
		const envelope = buildInvalidateGitDiffEnvelope({
			result: {
				diff: { filesChanged: 0, fromRef: "origin/main", toRef: "HEAD" },
				watchMatches: 0,
				softInvalidated: 0,
				hardInvalidated: 0,
				driftDetected: 0,
				skipped: 0,
				entries: [],
			},
			repository: null,
		});
		assertValid("empty", validate(envelope), validate.errors);
		expect(envelope.entries).toEqual([]);
	});

	it("rejects an unknown top-level field", () => {
		const golden = load<InvalidateGitDiffEnvelope>("golden-invalidate-git-diff.json");
		expect(validate({ ...golden, bogus: true })).toBe(false);
	});

	it("rejects an unknown action value", () => {
		const golden = load<InvalidateGitDiffEnvelope>("golden-invalidate-git-diff.json");
		const broken = {
			...golden,
			entries: [{ ...golden.entries[0], action: "rewrite_history" }],
		};
		expect(validate(broken)).toBe(false);
	});

	it("rejects an entry missing a required field", () => {
		const golden = load<InvalidateGitDiffEnvelope>("golden-invalidate-git-diff.json");
		const { reason: _r, ...partial } = golden.entries[0]!;
		const broken = { ...golden, entries: [partial] };
		expect(validate(broken)).toBe(false);
	});
});
