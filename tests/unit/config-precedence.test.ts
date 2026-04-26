// C1 · runtime-trust — precedence integration test.
//
// Verifies the Done-criterion of C1: "Werte überschreiben Built-in-Default,
// werden durch ENV/Flag überschrieben."  Reloads `src/config.ts` under
// controlled cwd + env to exercise each layer of the chain.

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PROJECT_CONFIG_FILENAME } from "../../src/config/project-config.js";

// Keys the precedence chain touches. Snapshot + mutate IN PLACE so the
// `env` binding `src/config.ts` imports from `node:process` keeps tracking
// the singleton — replacing `process.env` wholesale breaks that link in
// subsequent module re-evaluations under `vi.resetModules()`.
const MANAGED_KEYS = [
	"MEMORY_TRUST_THRESHOLD_DEFAULT",
	"MEMORY_TRUST_THRESHOLD_LOW",
	"MEMORY_TOKEN_BUDGET",
	"EMBEDDING_PROVIDER",
] as const;

let tmp: string;
let originalCwd: string;
let savedEnv: Record<string, string | undefined>;

beforeEach(() => {
	tmp = mkdtempSync(path.join(tmpdir(), "agent-memory-c1-prec-"));
	originalCwd = process.cwd();
	savedEnv = {};
	for (const k of MANAGED_KEYS) {
		savedEnv[k] = process.env[k];
		delete process.env[k];
	}
	process.chdir(tmp);
});

afterEach(() => {
	process.chdir(originalCwd);
	for (const k of MANAGED_KEYS) {
		if (savedEnv[k] === undefined) delete process.env[k];
		else process.env[k] = savedEnv[k];
	}
	rmSync(tmp, { recursive: true, force: true });
	vi.resetModules();
});

function writeConfig(body: string): void {
	writeFileSync(path.join(tmp, PROJECT_CONFIG_FILENAME), body, "utf8");
}

async function reloadConfig(): Promise<typeof import("../../src/config.js")> {
	vi.resetModules();
	return import("../../src/config.js");
}

describe("config precedence — ENV > YAML > default", () => {
	it("case 1 · no YAML + no ENV → built-in defaults", async () => {
		const { config } = await reloadConfig();
		expect(config.trust.thresholdDefault).toBe(0.6);
		expect(config.tokenBudget).toBe(2000);
		expect(config.embedding.provider).toBe("bm25-only");
		expect(config.repository).toBeNull();
	});

	it("case 2 · YAML only → YAML wins over default", async () => {
		writeConfig(
			[
				"version: 1",
				"repository: acme/checkout",
				"trust:",
				"  threshold: 0.75",
				"retrieval:",
				"  token_budget: 3500",
				"embedding:",
				"  provider: gemini",
				"",
			].join("\n"),
		);
		const { config } = await reloadConfig();
		expect(config.trust.thresholdDefault).toBe(0.75);
		expect(config.tokenBudget).toBe(3500);
		expect(config.embedding.provider).toBe("gemini");
		expect(config.repository).toBe("acme/checkout");
	});

	it("case 3 · ENV only → ENV wins over default, no YAML loaded", async () => {
		process.env.MEMORY_TRUST_THRESHOLD_DEFAULT = "0.85";
		process.env.MEMORY_TOKEN_BUDGET = "4000";
		process.env.EMBEDDING_PROVIDER = "openai";
		const { config } = await reloadConfig();
		expect(config.trust.thresholdDefault).toBe(0.85);
		expect(config.tokenBudget).toBe(4000);
		expect(config.embedding.provider).toBe("openai");
	});

	it("case 4 · ENV + YAML → ENV wins over YAML", async () => {
		writeConfig(
			[
				"version: 1",
				"trust:",
				"  threshold: 0.4",
				"retrieval:",
				"  token_budget: 1500",
				"embedding:",
				"  provider: voyage",
				"",
			].join("\n"),
		);
		process.env.MEMORY_TRUST_THRESHOLD_DEFAULT = "0.9";
		process.env.MEMORY_TOKEN_BUDGET = "5000";
		process.env.EMBEDDING_PROVIDER = "openai";
		const { config } = await reloadConfig();
		expect(config.trust.thresholdDefault).toBe(0.9);
		expect(config.tokenBudget).toBe(5000);
		expect(config.embedding.provider).toBe("openai");
	});

	it("case 5 · YAML partial → merged with defaults for untouched keys", async () => {
		writeConfig(["version: 1", "trust:", "  threshold: 0.5", ""].join("\n"));
		const { config } = await reloadConfig();
		expect(config.trust.thresholdDefault).toBe(0.5);
		// token_budget absent in YAML → falls back to built-in default
		expect(config.tokenBudget).toBe(2000);
		// embedding absent in YAML → built-in default
		expect(config.embedding.provider).toBe("bm25-only");
	});

	it("case 6 · invalid YAML → config captures error, assertProjectConfigOk exits 1", async () => {
		writeConfig("version: 1\nbogus_field: true\n");
		const { getProjectConfigStatus, assertProjectConfigOk } = await reloadConfig();
		const status = getProjectConfigStatus();
		expect(status.error).not.toBeNull();
		expect(status.error?.message).toMatch(/agent-memory-config-v1/);
		const exitSpy = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
			throw new Error(`__exit:${code}`);
		}) as never);
		const errSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
		expect(() => assertProjectConfigOk()).toThrow(/__exit:1/);
		expect(errSpy).toHaveBeenCalled();
		exitSpy.mockRestore();
		errSpy.mockRestore();
	});

	it("case 7 · policies block is exposed to the C2 consumer", async () => {
		writeConfig(
			[
				"version: 1",
				"policies:",
				"  fail_on_contradicted_critical: true",
				"  fail_on_invalidated_adr: false",
				"",
			].join("\n"),
		);
		const { config } = await reloadConfig();
		expect(config.policies.fail_on_contradicted_critical).toBe(true);
		expect(config.policies.fail_on_invalidated_adr).toBe(false);
	});
});
