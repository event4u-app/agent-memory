// C1 · runtime-trust — loader unit tests for `.agent-memory.yml`.
// The precedence integration (ENV > YAML > default) is covered separately
// in tests/unit/config-precedence.test.ts; this file focuses on parsing,
// validation, and file discovery.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
	findConfigPath,
	loadProjectConfig,
	PROJECT_CONFIG_FILENAME,
	ProjectConfigError,
	validateProjectConfig,
} from "../../src/config/project-config.js";

let tmp: string;

beforeEach(() => {
	tmp = mkdtempSync(path.join(tmpdir(), "agent-memory-c1-"));
});

afterEach(() => {
	rmSync(tmp, { recursive: true, force: true });
});

function writeConfig(dir: string, body: string): string {
	const p = path.join(dir, PROJECT_CONFIG_FILENAME);
	writeFileSync(p, body, "utf8");
	return p;
}

describe("loadProjectConfig — file discovery", () => {
	it("returns null when no .agent-memory.yml is found", () => {
		const result = loadProjectConfig(tmp);
		expect(result).toEqual({ config: null, path: null });
	});

	it("walks up the directory tree until it finds .agent-memory.yml", () => {
		writeConfig(tmp, "version: 1\nrepository: acme/checkout\n");
		const nested = path.join(tmp, "a", "b", "c");
		mkdirSync(nested, { recursive: true });
		const result = loadProjectConfig(nested);
		expect(result.path).toBe(path.join(tmp, PROJECT_CONFIG_FILENAME));
		expect(result.config?.repository).toBe("acme/checkout");
	});

	it("findConfigPath returns null at filesystem root", () => {
		expect(findConfigPath(tmp)).toBeNull();
	});
});

describe("loadProjectConfig — YAML parsing + schema validation", () => {
	it("parses a minimal valid config", () => {
		writeConfig(tmp, "version: 1\n");
		const { config } = loadProjectConfig(tmp);
		expect(config).toEqual({ version: 1 });
	});

	it("accepts every documented field", () => {
		writeConfig(
			tmp,
			[
				"version: 1",
				"repository: acme/checkout",
				"trust:",
				"  threshold: 0.7",
				"  threshold_low: 0.4",
				"retrieval:",
				"  token_budget: 3000",
				"embedding:",
				"  provider: gemini",
				"decay:",
				"  profile: conservative",
				"policies:",
				"  fail_on_contradicted_critical: true",
				"  fail_on_invalidated_adr: true",
				"  min_trust_for_type:",
				"    architecture_decision: 0.8",
				"  block_on_poisoned_referenced: true",
				"",
			].join("\n"),
		);
		const { config } = loadProjectConfig(tmp);
		expect(config?.policies?.fail_on_contradicted_critical).toBe(true);
		expect(config?.trust?.threshold).toBe(0.7);
		expect(config?.embedding?.provider).toBe("gemini");
	});

	it("rejects malformed YAML with ProjectConfigError", () => {
		writeConfig(tmp, "version: 1\n  : : :\n");
		expect(() => loadProjectConfig(tmp)).toThrow(ProjectConfigError);
	});

	it("rejects a top-level array (must be a mapping)", () => {
		writeConfig(tmp, "- version: 1\n");
		expect(() => loadProjectConfig(tmp)).toThrow(/mapping at the top level/);
	});

	it("rejects unknown top-level fields (additionalProperties: false)", () => {
		writeConfig(tmp, "version: 1\nbogus_field: 42\n");
		expect(() => loadProjectConfig(tmp)).toThrow(/agent-memory-config-v1/);
	});

	it("rejects out-of-range trust.threshold", () => {
		writeConfig(tmp, "version: 1\ntrust:\n  threshold: 1.5\n");
		expect(() => loadProjectConfig(tmp)).toThrow(/agent-memory-config-v1/);
	});

	it("rejects an unknown embedding.provider", () => {
		writeConfig(tmp, "version: 1\nembedding:\n  provider: whisper\n");
		expect(() => loadProjectConfig(tmp)).toThrow(/agent-memory-config-v1/);
	});

	it("rejects version != 1", () => {
		writeConfig(tmp, "version: 2\n");
		expect(() => loadProjectConfig(tmp)).toThrow(/agent-memory-config-v1/);
	});

	it("includes the failing file path on the error", () => {
		const p = writeConfig(tmp, "version: 1\nbogus: 1\n");
		try {
			loadProjectConfig(tmp);
			expect.unreachable();
		} catch (err) {
			expect(err).toBeInstanceOf(ProjectConfigError);
			expect((err as ProjectConfigError).filePath).toBe(p);
		}
	});
});

describe("validateProjectConfig — pure validation helper", () => {
	it("accepts a valid config", () => {
		expect(validateProjectConfig({ version: 1, repository: "x" })).toEqual({
			version: 1,
			repository: "x",
		});
	});

	it("throws on schema violation", () => {
		expect(() => validateProjectConfig({ version: 0 })).toThrow(/schema/);
	});
});
