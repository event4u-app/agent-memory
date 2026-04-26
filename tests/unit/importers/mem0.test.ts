// D4 · runtime-trust — Mem0 importer mapper coverage.
//
// We don't spin up Postgres in this suite (project convention: contract
// + unit tests only), so "end-to-end" here means: fixture JSONL → mapper
// → schema-valid ExportEntryLine ready for importEntries(). The Ajv pass
// against export-v1.schema.json proves the mapper output drops cleanly
// into the existing import pipeline without re-running the writes.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import Ajv from "ajv";
import addFormats from "ajv-formats";
import { describe, expect, it } from "vitest";
import {
	convertMem0Record,
	type Mem0Record,
	parseMem0Jsonl,
} from "../../../src/ingestion/importers/mem0.js";

const FIXTURE = join(process.cwd(), "tests/fixtures/importers/mem0/sample.jsonl");
const SCHEMA = join(process.cwd(), "tests/fixtures/retrieval/export-v1.schema.json");
const NOW = new Date("2026-04-25T00:00:00.000Z");

function loadValidator() {
	const schema = JSON.parse(readFileSync(SCHEMA, "utf-8")) as object;
	const ajv = new Ajv({ allErrors: true, strict: false });
	addFormats(ajv);
	return ajv.compile(schema);
}

describe("convertMem0Record", () => {
	it("maps the canonical fields to ExportEntryLine", () => {
		const raw: Mem0Record = {
			id: "mem0-id-1",
			memory: "Use ULID, not UUIDv4, for new public-facing IDs.",
			created_at: "2026-01-15T10:00:00.000Z",
			categories: ["coding_convention"],
		};
		const line = convertMem0Record(raw, { repository: "acme/web", now: NOW });
		expect(line.kind).toBe("entry");
		expect(line.entry.summary).toBe(raw.memory);
		expect(line.entry.embedding_text).toBe(raw.memory);
		expect(line.entry.title).toBe("Use ULID, not UUIDv4, for new public-facing IDs");
		expect(line.entry.scope.repository).toBe("acme/web");
		expect(line.entry.created_at).toBe("2026-01-15T10:00:00.000Z");
		expect(line.entry.created_by).toBe("import:mem0");
		expect(line.entry.trust.status).toBe("validated");
		expect(line.entry.trust.score).toBe(0.5);
		expect(line.entry.trust.validated_at).toBe(NOW.toISOString());
		expect(line.entry.promotion_metadata.imported_from).toBe("mem0");
		expect(line.entry.promotion_metadata.mem0_id).toBe("mem0-id-1");
		expect(line.evidence).toEqual([]);
		expect(line.events).toEqual([]);
		expect(line.redaction.applied).toBe(false);
	});

	it("--quarantine flag changes status and clears validated_at", () => {
		const line = convertMem0Record(
			{ memory: "Some note" },
			{ repository: "acme/web", quarantine: true, now: NOW },
		);
		expect(line.entry.trust.status).toBe("quarantine");
		expect(line.entry.trust.validated_at).toBeNull();
	});

	it("falls back through memory|text|content", () => {
		const a = convertMem0Record({ text: "Alpha" }, { repository: "r", now: NOW });
		const b = convertMem0Record({ content: "Beta" }, { repository: "r", now: NOW });
		expect(a.entry.summary).toBe("Alpha");
		expect(b.entry.summary).toBe("Beta");
	});

	it("title truncates with ellipsis past 80 chars", () => {
		const long = "a".repeat(120);
		const line = convertMem0Record({ memory: long }, { repository: "r", now: NOW });
		expect(line.entry.title.length).toBeLessThanOrEqual(80);
		expect(line.entry.title.endsWith("…")).toBe(true);
	});

	it("preserves Mem0 metadata in details JSON", () => {
		const raw: Mem0Record = {
			memory: "x",
			categories: ["a", "b"],
			metadata: { jira: "X-1" },
			user_id: "u1",
		};
		const line = convertMem0Record(raw, { repository: "r", now: NOW });
		const details = JSON.parse(line.entry.details ?? "{}");
		expect(details.categories).toEqual(["a", "b"]);
		expect(details.metadata).toEqual({ jira: "X-1" });
		expect(details.user_id).toBe("u1");
	});

	it("rejects empty repository, empty text, and out-of-range trust", () => {
		expect(() => convertMem0Record({ memory: "x" }, { repository: "", now: NOW })).toThrow(
			/repository/,
		);
		expect(() => convertMem0Record({}, { repository: "r", now: NOW })).toThrow(/no text/);
		expect(() =>
			convertMem0Record({ memory: "x" }, { repository: "r", initialTrust: 1.5, now: NOW }),
		).toThrow(/initialTrust/);
	});

	it("expires_at uses semi_stable TTL (30 days from now)", () => {
		const line = convertMem0Record({ memory: "x" }, { repository: "r", now: NOW });
		const expires = new Date(line.entry.trust.expires_at).getTime();
		const expected = NOW.getTime() + 30 * 24 * 60 * 60 * 1000;
		expect(expires).toBe(expected);
	});
});

describe("parseMem0Jsonl + Ajv schema compatibility", () => {
	it("converts the golden fixture to schema-valid entry lines", () => {
		const content = readFileSync(FIXTURE, "utf-8");
		const lines = parseMem0Jsonl(content, { repository: "acme/web", now: NOW });
		expect(lines).toHaveLength(5);
		const validate = loadValidator();
		for (const line of lines) {
			if (!validate(line)) {
				throw new Error(`schema invalid: ${JSON.stringify(validate.errors, null, 2)}`);
			}
		}
		expect(lines[0]?.entry.promotion_metadata.mem0_id).toBe("a1111111-1111-1111-1111-111111111111");
		expect(lines[2]?.entry.summary).toBe("Use ULID, not UUIDv4, for new public-facing IDs.");
		expect(lines[3]?.entry.summary).toBe("Never log raw request bodies — they may contain PII.");
	});

	it("aborts on the first malformed line (no partial state)", () => {
		const content = '{"memory":"ok"}\nthis is not json\n{"memory":"also-ok"}\n';
		expect(() => parseMem0Jsonl(content, { repository: "r", now: NOW })).toThrow(/line 2/);
	});

	it("skips blank lines", () => {
		const content = '\n{"memory":"a"}\n\n{"memory":"b"}\n\n';
		const lines = parseMem0Jsonl(content, { repository: "r", now: NOW });
		expect(lines).toHaveLength(2);
	});
});
