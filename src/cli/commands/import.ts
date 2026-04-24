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
import { closeDb, getDb } from "../context.js";

const SCHEMA_PATH = join(process.cwd(), "tests/fixtures/retrieval/export-v1.schema.json");

function loadSchema(): object {
	return JSON.parse(readFileSync(SCHEMA_PATH, "utf-8")) as object;
}

function parseOnConflict(raw: string | undefined): OnConflict {
	if (!raw || raw === "fail") return "fail";
	if (raw === "update" || raw === "skip") return raw;
	throw new Error(`invalid --on-conflict: ${raw} (expected fail | update | skip)`);
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
		.action(async (file: string, options: { onConflict?: string }) => {
			try {
				const onConflict = parseOnConflict(options.onConflict);
				const content = readFileSync(file, "utf-8");
				const parsed = parseExportJsonl(content);

				// Ajv pass — validate every line envelope before any DB write.
				// We check lines individually so a malformed entry line does
				// not swallow the header error, and vice versa.
				const ajv = new Ajv({ allErrors: true, strict: false });
				addFormats(ajv);
				const validate = ajv.compile(loadSchema());
				for (const line of [parsed.header, ...parsed.entries]) {
					if (!validate(line)) {
						throw new Error(
							`schema validation failed: ${JSON.stringify(validate.errors, null, 2)}`,
						);
					}
				}

				const sql = getDb();
				const stats = await importEntries(sql, parsed.entries, onConflict);
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
