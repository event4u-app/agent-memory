// Project-local config layer for `.agent-memory.yml` (C1 · runtime-trust).
//
// Precedence (highest first, as Done-criterion of C1):
//   CLI flag  >  ENV  >  YAML  >  built-in default
//
// This loader covers the YAML hop. ENV parsing stays in src/config.ts so
// heute-Pinner (ENV-only setups) bleiben unverändert. The loader returns a
// *validated* ProjectConfig. Invalid YAML or schema violations throw — the
// CLI turns those into exit 1, no silent fallback (C1-Done #2).
//
// File discovery: the loader walks up from cwd to the first ancestor that
// contains `.agent-memory.yml`. `package.json` at that level is not required;
// the file's presence is the signal.

import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Ajv, { type ValidateFunction } from "ajv";
import addFormats from "ajv-formats";
import { parse as parseYaml } from "yaml";

export const PROJECT_CONFIG_FILENAME = ".agent-memory.yml";

// Schema lives at `schema/agent-memory-config-v1.schema.json` at the package
// root (outside src/). We read it at runtime to keep the single source of
// truth for both runtime validation (this module) and external consumers
// (published as part of the npm package via the `files` field).
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCHEMA_PATH = path.resolve(__dirname, "../../schema/agent-memory-config-v1.schema.json");

export interface ProjectConfig {
	version: 1;
	repository?: string;
	trust?: { threshold?: number; threshold_low?: number };
	retrieval?: { token_budget?: number };
	embedding?: { provider?: "local" | "gemini" | "openai" | "voyage" | "bm25-only" };
	decay?: { profile?: "default" | "conservative" | "aggressive" };
	policies?: {
		fail_on_contradicted_critical?: boolean;
		fail_on_invalidated_adr?: boolean;
		min_trust_for_type?: { architecture_decision?: number };
		block_on_poisoned_referenced?: boolean;
	};
}

export interface LoadResult {
	config: ProjectConfig | null;
	path: string | null;
}

let cachedValidator: ValidateFunction | null = null;

function getValidator(): ValidateFunction {
	if (cachedValidator) return cachedValidator;
	const schemaJson = JSON.parse(readFileSync(SCHEMA_PATH, "utf8"));
	const ajv = new Ajv({ allErrors: true, strict: false });
	addFormats(ajv);
	cachedValidator = ajv.compile(schemaJson);
	return cachedValidator;
}

export function findConfigPath(startDir: string): string | null {
	let current = path.resolve(startDir);
	const root = path.parse(current).root;
	while (true) {
		const candidate = path.join(current, PROJECT_CONFIG_FILENAME);
		try {
			const stat = statSync(candidate);
			if (stat.isFile()) return candidate;
		} catch {
			// ENOENT → keep walking
		}
		if (current === root) return null;
		current = path.dirname(current);
	}
}

export class ProjectConfigError extends Error {
	constructor(
		message: string,
		public readonly filePath: string,
	) {
		super(message);
		this.name = "ProjectConfigError";
	}
}

/**
 * Load `.agent-memory.yml` from the given directory (or any ancestor).
 * Returns `{ config: null, path: null }` when no file exists — that is
 * the silent, permitted case. Invalid YAML or schema violations throw
 * `ProjectConfigError` so the caller (CLI entrypoint) can exit 1.
 */
export function loadProjectConfig(cwd: string = process.cwd()): LoadResult {
	const filePath = findConfigPath(cwd);
	if (!filePath) return { config: null, path: null };

	let raw: string;
	try {
		raw = readFileSync(filePath, "utf8");
	} catch (err) {
		throw new ProjectConfigError(
			`failed to read ${PROJECT_CONFIG_FILENAME}: ${(err as Error).message}`,
			filePath,
		);
	}

	let parsed: unknown;
	try {
		parsed = parseYaml(raw);
	} catch (err) {
		throw new ProjectConfigError(
			`${PROJECT_CONFIG_FILENAME} is not valid YAML: ${(err as Error).message}`,
			filePath,
		);
	}

	if (parsed == null || typeof parsed !== "object" || Array.isArray(parsed)) {
		throw new ProjectConfigError(
			`${PROJECT_CONFIG_FILENAME} must be a YAML mapping at the top level`,
			filePath,
		);
	}

	const validate = getValidator();
	if (!validate(parsed)) {
		const msg = (validate.errors ?? [])
			.map((e) => `${e.instancePath || "/"} ${e.message ?? "invalid"}`)
			.join("; ");
		throw new ProjectConfigError(
			`${PROJECT_CONFIG_FILENAME} violates agent-memory-config-v1 schema: ${msg}`,
			filePath,
		);
	}

	return { config: parsed as ProjectConfig, path: filePath };
}

/** Typed helper for test fixtures — does not touch the filesystem. */
export function validateProjectConfig(raw: unknown): ProjectConfig {
	const validate = getValidator();
	if (!validate(raw)) {
		const msg = (validate.errors ?? [])
			.map((e) => `${e.instancePath || "/"} ${e.message ?? "invalid"}`)
			.join("; ");
		throw new Error(`config violates schema: ${msg}`);
	}
	return raw as ProjectConfig;
}
