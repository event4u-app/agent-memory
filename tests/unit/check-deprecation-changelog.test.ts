// D5 · runtime-trust — regression for scripts/check-deprecation-changelog.ts.
//
// The guard walks schema dirs under a working root, flags any schema with
// `"deprecated": true`, and requires the filename stem in the top
// CHANGELOG block. The contract lives in docs/deprecation-policy.md.
//
// Each case spawns the real script in a temp root — no stubbing of the
// filesystem helpers, so behavior is identical to CI invocations.

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const SCRIPT = resolve(process.cwd(), "scripts/check-deprecation-changelog.ts");

interface RunResult {
	status: number;
	stdout: string;
	stderr: string;
}

function run(cwd: string): RunResult {
	try {
		const stdout = execFileSync("npx", ["-y", "tsx", SCRIPT], {
			cwd,
			encoding: "utf-8",
			stdio: ["ignore", "pipe", "pipe"],
		});
		return { status: 0, stdout, stderr: "" };
	} catch (e) {
		const err = e as { status?: number; stdout?: string; stderr?: string };
		return {
			status: err.status ?? 1,
			stdout: err.stdout ?? "",
			stderr: err.stderr ?? "",
		};
	}
}

function makeRoot(): string {
	const root = mkdtempSync(join(tmpdir(), "deprecation-guard-"));
	mkdirSync(join(root, "tests/fixtures/retrieval"), { recursive: true });
	mkdirSync(join(root, "schema"), { recursive: true });
	return root;
}

function writeSchema(root: string, name: string, schema: Record<string, unknown>): void {
	writeFileSync(join(root, "tests/fixtures/retrieval", name), JSON.stringify(schema));
}

function writeChangelog(root: string, body: string): void {
	writeFileSync(join(root, "CHANGELOG.md"), body);
}

const roots: string[] = [];

beforeAll(() => {
	/* empty: roots are created per-test and tracked for cleanup */
});

afterAll(() => {
	for (const r of roots) rmSync(r, { recursive: true, force: true });
});

function scenario(): string {
	const root = makeRoot();
	roots.push(root);
	return root;
}

describe("check-deprecation-changelog drift guard", () => {
	it("clean state passes with exit 0 when no schemas are flagged", () => {
		const root = scenario();
		writeSchema(root, "sample-v1.schema.json", { type: "object" });
		writeChangelog(root, "# Changelog\n\n## [Unreleased]\n\nNo changes.\n");
		const r = run(root);
		expect(r.status).toBe(0);
		expect(r.stdout).toContain("no deprecations flagged");
	});

	it("passes when a flagged schema is mentioned in the top CHANGELOG block", () => {
		const root = scenario();
		writeSchema(root, "example-v1.schema.json", {
			type: "object",
			properties: { old: { type: "string", deprecated: true } },
		});
		writeChangelog(
			root,
			"# Changelog\n\n## [Unreleased]\n\n### Deprecated\n- `example-v1.schema` — removed in 2.0.\n",
		);
		const r = run(root);
		expect(r.status).toBe(0);
		expect(r.stdout).toContain("all present in CHANGELOG");
	});

	it("fails with exit 1 when a flagged schema is missing from the top block", () => {
		const root = scenario();
		writeSchema(root, "missing-v1.schema.json", {
			deprecated: true,
			type: "object",
		});
		writeChangelog(root, "# Changelog\n\n## [Unreleased]\n\n_No unreleased changes._\n");
		const r = run(root);
		expect(r.status).toBe(1);
		expect(r.stderr).toContain("missing-v1.schema");
	});

	it("fails when the CHANGELOG cites a schema that is not flagged deprecated", () => {
		const root = scenario();
		writeSchema(root, "live-v1.schema.json", { type: "object" });
		writeChangelog(
			root,
			"# Changelog\n\n## [Unreleased]\n\n### Deprecated\n- `ghost-v1.schema` — never existed.\n",
		);
		const r = run(root);
		expect(r.status).toBe(1);
		expect(r.stderr).toContain("ghost-v1.schema");
	});

	it("only matches the top CHANGELOG block, not older releases", () => {
		const root = scenario();
		writeSchema(root, "older-v1.schema.json", {
			type: "object",
			deprecated: true,
		});
		writeChangelog(
			root,
			[
				"# Changelog",
				"",
				"## [Unreleased]",
				"",
				"_No unreleased changes._",
				"",
				"## [1.1.0]",
				"",
				"### Deprecated",
				"- `older-v1.schema` — shipped release, older block.",
			].join("\n"),
		);
		const r = run(root);
		expect(r.status).toBe(1);
		expect(r.stderr).toContain("older-v1.schema");
	});
});
