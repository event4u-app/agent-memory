// D1 · runtime-trust — unit tests for the export/import services.
//
// - runExport streams a header + one line per entry through a mocked
//   repo stack, filters by repository + since, and counts redactions.
// - verifyNoSecretLeak rejects an incoming line that lies about its
//   `redaction.applied=false` (III3 belt-and-braces on import).

import { describe, expect, it } from "vitest";
import type { MemoryEvent } from "../../src/db/repositories/memory-event.repository.js";
import { runExport } from "../../src/export/export-service.js";
import { ImportSecretLeakError, verifyNoSecretLeak } from "../../src/export/import-service.js";
import { parseExportJsonl } from "../../src/export/parse.js";
import type { ExportEntryLine } from "../../src/export/types.js";
import type { MemoryEntry, MemoryEvidence } from "../../src/types.js";

const FIXED_NOW = new Date("2026-04-24T00:00:00.000Z");
const AWS_KEY = "AKIAIOSFODNN7EXAMPLE";

function makeEntry(overrides: Partial<MemoryEntry> = {}): MemoryEntry {
	return {
		id: overrides.id ?? "11111111-1111-1111-1111-111111111111",
		type: "architecture_decision",
		title: "Title",
		summary: "Summary",
		details: null,
		scope: {
			repository: "acme/checkout",
			files: ["src/a.ts"],
			symbols: ["A"],
			modules: ["core"],
		},
		impactLevel: "high",
		knowledgeClass: "semi_stable",
		consolidationTier: "semantic",
		trust: {
			status: "validated",
			score: 0.8,
			validatedAt: new Date("2026-03-01T10:00:00.000Z"),
			expiresAt: new Date("2026-06-01T10:00:00.000Z"),
		},
		embeddingText: "text",
		embedding: null,
		accessCount: 0,
		lastAccessedAt: null,
		createdBy: "agent",
		createdInTask: null,
		createdAt: new Date("2026-02-01T00:00:00.000Z"),
		updatedAt: new Date("2026-03-01T10:00:00.000Z"),
		promotionMetadata: {},
		...overrides,
	};
}

function mockRepos(entries: MemoryEntry[]) {
	return {
		entryRepo: {
			async *iterateAll(_batch: number) {
				yield entries;
			},
		} as unknown as import("../../src/db/repositories/memory-entry.repository.js").MemoryEntryRepository,
		evidenceRepo: {
			findByEntryId: async (): Promise<MemoryEvidence[]> => [],
		} as unknown as import("../../src/db/repositories/evidence.repository.js").EvidenceRepository,
		eventRepo: {
			listByEntry: async (): Promise<MemoryEvent[]> => [],
		} as unknown as import("../../src/db/repositories/memory-event.repository.js").MemoryEventRepository,
	};
}

describe("runExport — D1 JSONL streaming", () => {
	it("emits a header + one line per matching entry", async () => {
		const entries = [makeEntry({ id: "a" }), makeEntry({ id: "b" })];
		const buf: string[] = [];
		const summary = await runExport(mockRepos(entries), (l) => buf.push(l), {
			now: FIXED_NOW,
		});
		expect(summary.entry_count).toBe(2);
		const parsed = parseExportJsonl(buf.join(""));
		expect(parsed.header.entry_count).toBe(2);
		expect(parsed.entries).toHaveLength(2);
		// Sorted by id for stable output.
		expect(parsed.entries.map((e) => e.entry.id)).toEqual(["a", "b"]);
	});

	it("filters by repository and --since updated_at", async () => {
		const entries = [
			makeEntry({ id: "keep", updatedAt: new Date("2026-03-15T00:00:00.000Z") }),
			makeEntry({ id: "oldsince", updatedAt: new Date("2026-02-15T00:00:00.000Z") }),
			makeEntry({
				id: "wrong-repo",
				scope: {
					repository: "other/repo",
					files: [],
					symbols: [],
					modules: [],
				},
			}),
		];
		const buf: string[] = [];
		await runExport(mockRepos(entries), (l) => buf.push(l), {
			now: FIXED_NOW,
			since: "2026-03-01T00:00:00.000Z",
			repository: "acme/checkout",
		});
		const parsed = parseExportJsonl(buf.join(""));
		expect(parsed.entries.map((e) => e.entry.id)).toEqual(["keep"]);
		expect(parsed.header.filters).toEqual({
			since: "2026-03-01T00:00:00.000Z",
			repository: "acme/checkout",
		});
	});

	it("counts redacted entries when secrets appear in entry text", async () => {
		const entries = [makeEntry({ id: "clean" }), makeEntry({ id: "leaky", summary: AWS_KEY })];
		const buf: string[] = [];
		const summary = await runExport(mockRepos(entries), (l) => buf.push(l), { now: FIXED_NOW });
		expect(summary.redacted_count).toBe(1);
		const parsed = parseExportJsonl(buf.join(""));
		const leaky = parsed.entries.find((e) => e.entry.id === "leaky");
		expect(leaky?.redaction.applied).toBe(true);
		expect(leaky?.redaction.patterns).toContain("aws_access_key");
		expect(leaky?.entry.summary).not.toContain(AWS_KEY);
	});
});

describe("verifyNoSecretLeak — III3 import-side guard", () => {
	function lineWith(overrides: Partial<ExportEntryLine["entry"]> = {}): ExportEntryLine {
		return {
			kind: "entry",
			entry: {
				id: "x",
				type: "architecture_decision",
				title: "t",
				summary: "s",
				details: null,
				scope: { repository: "r", files: [], symbols: [], modules: [] },
				impact_level: "high",
				knowledge_class: "semi_stable",
				consolidation_tier: "semantic",
				trust: {
					status: "validated",
					score: 0.8,
					validated_at: null,
					expires_at: "2026-06-01T10:00:00.000Z",
				},
				embedding_text: "e",
				access_count: 0,
				last_accessed_at: null,
				created_by: "agent",
				created_in_task: null,
				created_at: "2026-02-01T00:00:00.000Z",
				updated_at: "2026-03-01T10:00:00.000Z",
				promotion_metadata: {},
				...overrides,
			},
			evidence: [],
			events: [],
			redaction: { applied: false, patterns: [], version: "1" },
		};
	}

	it("accepts a line that was already redacted by the exporter", () => {
		const line = lineWith({ summary: AWS_KEY });
		line.redaction = { applied: true, patterns: ["aws_access_key"], version: "1" };
		expect(() => verifyNoSecretLeak(line)).not.toThrow();
	});

	it("rejects a line claiming applied=false but carrying a secret", () => {
		const line = lineWith({ summary: `leak ${AWS_KEY}` });
		expect(() => verifyNoSecretLeak(line)).toThrow(ImportSecretLeakError);
	});

	it("accepts a clean applied=false line", () => {
		expect(() => verifyNoSecretLeak(lineWith())).not.toThrow();
	});
});
