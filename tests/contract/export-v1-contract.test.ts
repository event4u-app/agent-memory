// D1 · runtime-trust — contract test for `memory export` / `memory import`.
//
// Pins the JSONL line envelope (export-v1). Every line — header or
// entry — must validate individually against `export-v1.schema.json`
// with `additionalProperties: false` end-to-end.
//
// Also verifies the roundtrip invariant the roadmap pins: parsing the
// golden fixture and re-serialising each line reproduces byte-identical
// output. Any key reorder in `serialize.ts` or `redaction.ts` would
// break this.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import Ajv from "ajv";
import addFormats from "ajv-formats";
import { describe, expect, it } from "vitest";

import {
	buildEntryLine,
	buildHeader,
	EXPORT_CONTRACT_VERSION,
	EXPORT_REDACTION_VERSION,
	type ExportEntryLine,
	type ExportHeaderLine,
	formatLine,
	parseExportJsonl,
} from "../../src/export/index.js";

const FIXTURE_DIR = join(process.cwd(), "tests/fixtures/retrieval");

function load(file: string): string {
	return readFileSync(join(FIXTURE_DIR, file), "utf-8");
}

function loadJson<T = unknown>(file: string): T {
	return JSON.parse(load(file)) as T;
}

const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);
const validate = ajv.compile(loadJson("export-v1.schema.json"));

describe("export-v1 contract — schema conformance", () => {
	it("header line in golden fixture validates", () => {
		const { header } = parseExportJsonl(load("golden-export.jsonl"));
		expect(validate(header)).toBe(true);
		expect(header.contract_version).toBe(EXPORT_CONTRACT_VERSION);
		expect(header.redaction_version).toBe(EXPORT_REDACTION_VERSION);
	});

	it("every entry line in golden fixture validates", () => {
		const { entries } = parseExportJsonl(load("golden-export.jsonl"));
		for (const entry of entries) {
			const ok = validate(entry);
			if (!ok) {
				throw new Error(
					`entry ${entry.entry.id} failed: ${JSON.stringify(validate.errors, null, 2)}`,
				);
			}
		}
	});

	it("entry_count in header matches actual entries", () => {
		const { header, entries } = parseExportJsonl(load("golden-export.jsonl"));
		expect(header.entry_count).toBe(entries.length);
	});

	it("rejects an unknown top-level field on a header", () => {
		const { header } = parseExportJsonl(load("golden-export.jsonl"));
		expect(validate({ ...header, bogus: 1 })).toBe(false);
	});

	it("rejects an unknown top-level field on an entry line", () => {
		const { entries } = parseExportJsonl(load("golden-export.jsonl"));
		expect(validate({ ...entries[0], stowaway: "x" })).toBe(false);
	});

	it("rejects an entry missing a required field", () => {
		const { entries } = parseExportJsonl(load("golden-export.jsonl"));
		const broken: ExportEntryLine = {
			...entries[0]!,
			entry: { ...entries[0]!.entry, title: undefined as unknown as string },
		};
		expect(validate(broken)).toBe(false);
	});

	it("rejects an unsupported redaction.version", () => {
		const { entries } = parseExportJsonl(load("golden-export.jsonl"));
		const broken = {
			...entries[0]!,
			redaction: { ...entries[0]!.redaction, version: "99" },
		};
		expect(validate(broken)).toBe(false);
	});

	it("golden-export.jsonl re-serialises byte-identical (roundtrip invariant)", () => {
		const original = load("golden-export.jsonl");
		const { header, entries } = parseExportJsonl(original);
		const rebuilt = [
			formatLine(header as ExportHeaderLine),
			...entries.map((e) => formatLine(e)),
		].join("");
		expect(rebuilt).toBe(original);
	});

	it("buildHeader + buildEntryLine output validates end-to-end", () => {
		const header = buildHeader({
			exportedAt: new Date("2026-04-24T00:00:00.000Z"),
			entryCount: 0,
			filters: { since: null, repository: null },
		});
		expect(validate(header)).toBe(true);
		const { entries } = parseExportJsonl(load("golden-export.jsonl"));
		const sample = entries[0]!;
		const rebuilt = buildEntryLine({
			// Re-feed the already-serialised shape back through buildEntryLine is
			// not the intended path; this is a smoke check that the builder
			// accepts plausible input and returns a valid envelope.
			entry: {
				id: sample.entry.id,
				type: sample.entry.type,
				title: sample.entry.title,
				summary: sample.entry.summary,
				details: sample.entry.details,
				scope: {
					repository: sample.entry.scope.repository,
					files: sample.entry.scope.files,
					symbols: sample.entry.scope.symbols,
					modules: sample.entry.scope.modules,
				},
				impactLevel: sample.entry.impact_level as "high",
				knowledgeClass: sample.entry.knowledge_class as "semi_stable",
				consolidationTier: sample.entry.consolidation_tier as "semantic",
				trust: {
					status: sample.entry.trust.status as "validated",
					score: sample.entry.trust.score,
					validatedAt: sample.entry.trust.validated_at
						? new Date(sample.entry.trust.validated_at)
						: null,
					expiresAt: new Date(sample.entry.trust.expires_at),
				},
				embeddingText: sample.entry.embedding_text,
				embedding: null,
				accessCount: sample.entry.access_count,
				lastAccessedAt: sample.entry.last_accessed_at
					? new Date(sample.entry.last_accessed_at)
					: null,
				createdBy: sample.entry.created_by,
				createdInTask: sample.entry.created_in_task,
				createdAt: new Date(sample.entry.created_at),
				updatedAt: new Date(sample.entry.updated_at),
				promotionMetadata: sample.entry.promotion_metadata,
			},
			evidence: [],
			events: [],
			redaction: sample.redaction,
		});
		expect(validate(rebuilt)).toBe(true);
	});
});
