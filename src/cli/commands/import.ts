// D1 · runtime-trust — `memory import <file>` CLI wrapper around
// importEntries(). Validates every line against `export-v1.schema.json`
// up front; on validation or conflict error, no writes have been made.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import Ajv from "ajv";
import addFormats from "ajv-formats";
import type { Command } from "commander";
import {
	ImportConflictError,
	ImportSecretLeakError,
	importEntries,
	type OnConflict,
} from "../../export/import-service.js";
import { parseExportJsonl } from "../../export/parse.js";
import type { ExportEntryLine } from "../../export/types.js";
import { parseMem0Jsonl } from "../../ingestion/importers/mem0.js";
import { closeDb, getDb } from "../context.js";

const SCHEMA_PATH = join(process.cwd(), "tests/fixtures/retrieval/export-v1.schema.json");

const SUPPORTED_FORMATS = ["agent-memory-v1", "mem0-jsonl"] as const;
type ImportFormat = (typeof SUPPORTED_FORMATS)[number];

function loadSchema(): object {
	return JSON.parse(readFileSync(SCHEMA_PATH, "utf-8")) as object;
}

function parseOnConflict(raw: string | undefined): OnConflict {
	if (!raw || raw === "fail") return "fail";
	if (raw === "update" || raw === "skip") return raw;
	throw new Error(`invalid --on-conflict: ${raw} (expected fail | update | skip)`);
}

function parseFormat(raw: string | undefined): ImportFormat {
	const value = raw ?? "agent-memory-v1";
	if ((SUPPORTED_FORMATS as readonly string[]).includes(value)) return value as ImportFormat;
	throw new Error(`invalid --from: ${value} (expected ${SUPPORTED_FORMATS.join(" | ")})`);
}

function parseInitialTrust(raw: string | undefined): number | undefined {
	if (raw === undefined) return undefined;
	const n = Number.parseFloat(raw);
	if (!Number.isFinite(n) || n < 0 || n > 1) {
		throw new Error(`invalid --initial-trust: ${raw} (expected number in [0,1])`);
	}
	return n;
}

interface ImportOptions {
	onConflict?: string;
	from?: string;
	initialTrust?: string;
	repository?: string;
	quarantine?: boolean;
}

function loadEntries(
	file: string,
	format: ImportFormat,
	options: ImportOptions,
): ExportEntryLine[] {
	const content = readFileSync(file, "utf-8");
	if (format === "mem0-jsonl") {
		if (!options.repository) {
			throw new Error("--repository is required when --from=mem0-jsonl");
		}
		return parseMem0Jsonl(content, {
			repository: options.repository,
			initialTrust: parseInitialTrust(options.initialTrust),
			quarantine: options.quarantine === true,
		});
	}
	return parseExportJsonl(content).entries;
}

export function register(program: Command): void {
	program
		.command("import <file>")
		.description("Import a JSONL export back into the store (D1 · runtime-trust)")
		.option(
			"--on-conflict <mode>",
			"What to do when an entry id already exists: fail | update | skip",
			"fail",
		)
		.option("--from <format>", `Source format: ${SUPPORTED_FORMATS.join(" | ")}`, "agent-memory-v1")
		.option("--repository <id>", "Target repository scope (required for non-native formats)")
		.option(
			"--initial-trust <score>",
			"Initial trust score for non-native imports (0..1, default 0.5)",
		)
		.option("--quarantine", "Import non-native records as quarantine instead of validated")
		.action(async (file: string, options: ImportOptions) => {
			try {
				const onConflict = parseOnConflict(options.onConflict);
				const format = parseFormat(options.from);
				const entries = loadEntries(file, format, options);

				// Ajv pass — validate every entry envelope (mapper or native)
				// against export-v1 before any DB write. Belt-and-braces:
				// the mapper produces schema-shaped output by construction,
				// but a refactor regression must surface here, not in SQL.
				const ajv = new Ajv({ allErrors: true, strict: false });
				addFormats(ajv);
				const validate = ajv.compile(loadSchema());
				for (const line of entries) {
					if (!validate(line)) {
						throw new Error(
							`schema validation failed: ${JSON.stringify(validate.errors, null, 2)}`,
						);
					}
				}

				const sql = getDb();
				const stats = await importEntries(sql, entries, onConflict);
				process.stdout.write(`${JSON.stringify(stats)}\n`);
				await closeDb();
				process.exit(0);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				const code =
					error instanceof ImportConflictError
						? "conflict"
						: error instanceof ImportSecretLeakError
							? "secret_leak"
							: "import_error";
				console.error(JSON.stringify({ error: message, code }));
				await closeDb();
				process.exit(1);
			}
		});
}
