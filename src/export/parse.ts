// D1 · runtime-trust — strict JSONL parser for the export envelope.
//
// Reject-on-first-error: one malformed line aborts the whole import so
// the DB never lands in partial state (roadmap D1 · Done criterion).
// Validation is shape-only here; the import service runs a second pass
// through Ajv against `export-v1.schema.json` before any write.

import { readFileSync } from "node:fs";
import {
	EXPORT_CONTRACT_VERSION,
	EXPORT_REDACTION_VERSION,
	type ExportEntryLine,
	type ExportHeaderLine,
	type ExportLine,
} from "./types.js";

export class ImportParseError extends Error {
	constructor(
		message: string,
		public readonly lineNumber: number,
	) {
		super(`line ${lineNumber}: ${message}`);
		this.name = "ImportParseError";
	}
}

function parseJson(raw: string, lineNumber: number): unknown {
	try {
		return JSON.parse(raw);
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		throw new ImportParseError(`invalid JSON — ${msg}`, lineNumber);
	}
}

function isObject(x: unknown): x is Record<string, unknown> {
	return typeof x === "object" && x !== null && !Array.isArray(x);
}

function classify(raw: unknown, lineNumber: number): ExportLine {
	if (!isObject(raw)) throw new ImportParseError("not a JSON object", lineNumber);
	const kind = raw.kind;
	if (kind === "header") {
		if (raw.contract_version !== EXPORT_CONTRACT_VERSION) {
			throw new ImportParseError(
				`unsupported contract_version: ${String(raw.contract_version)} (expected ${EXPORT_CONTRACT_VERSION})`,
				lineNumber,
			);
		}
		if (raw.redaction_version !== EXPORT_REDACTION_VERSION) {
			throw new ImportParseError(
				`unsupported redaction_version: ${String(raw.redaction_version)} (expected ${EXPORT_REDACTION_VERSION})`,
				lineNumber,
			);
		}
		return raw as unknown as ExportHeaderLine;
	}
	if (kind === "entry") {
		const redaction = raw.redaction;
		if (isObject(redaction) && redaction.version !== EXPORT_REDACTION_VERSION) {
			throw new ImportParseError(
				`unsupported redaction.version: ${String(redaction.version)} (expected ${EXPORT_REDACTION_VERSION})`,
				lineNumber,
			);
		}
		return raw as unknown as ExportEntryLine;
	}
	throw new ImportParseError(`unknown line kind: ${String(kind)}`, lineNumber);
}

export interface ParseResult {
	header: ExportHeaderLine;
	entries: ExportEntryLine[];
}

/**
 * Parse a full JSONL document. First non-empty line must be the header;
 * every remaining non-empty line must be an entry line. Blank lines are
 * tolerated (trailing newline is the common case).
 */
export function parseExportJsonl(content: string): ParseResult {
	const lines = content.split("\n");
	let header: ExportHeaderLine | null = null;
	const entries: ExportEntryLine[] = [];

	for (let i = 0; i < lines.length; i++) {
		const raw = lines[i];
		const lineNumber = i + 1;
		if (raw === undefined || raw.trim() === "") continue;
		const parsed = parseJson(raw, lineNumber);
		const classified = classify(parsed, lineNumber);
		if (classified.kind === "header") {
			if (header) throw new ImportParseError("duplicate header line", lineNumber);
			header = classified;
		} else {
			if (!header) throw new ImportParseError("entry line before header", lineNumber);
			entries.push(classified);
		}
	}

	if (!header) throw new ImportParseError("empty export — no header found", 0);
	if (header.entry_count !== entries.length) {
		throw new ImportParseError(
			`entry_count mismatch: header=${header.entry_count}, actual=${entries.length}`,
			0,
		);
	}
	return { header, entries };
}

export function readExportFile(path: string): ParseResult {
	const content = readFileSync(path, "utf-8");
	return parseExportJsonl(content);
}
