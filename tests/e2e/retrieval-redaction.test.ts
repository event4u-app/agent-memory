/**
 * III2 · Retrieval-Output-Filter — end-to-end canary test.
 *
 * Mirrors the spec's "Done" criterion verbatim: an entry that was inserted
 * *past* the ingress guard (legacy row, upgrade window, temporary detector
 * bug) is served through `memory_retrieve` — the response must contain
 * `[REDACTED:retrieve]`, a `RETRIEVE_POST_REDACT` warning, and no raw canary
 * byte. Equivalent, and the same pattern used by the other e2e tests, is a
 * mock `entryRepo.findByStatus(...)` that returns an entry carrying the
 * canary — contractually identical to `INSERT INTO memory_entries`.
 */

import { describe, expect, it, vi } from "vitest";
import type { McpContext } from "../../src/mcp/context.js";
import { handleToolCall } from "../../src/mcp/tool-handlers.js";
import type { MemoryEntry } from "../../src/types.js";
import { CANARIES } from "./canaries.js";

function buildCanaryEntry(canaryValue: string, id: string): MemoryEntry {
	return {
		id,
		type: "coding_convention",
		title: "innocent title",
		summary: `leaked ${canaryValue} in payload`,
		details: undefined,
		embeddingText: "n/a",
		scope: { repository: "repo-a", files: [], symbols: [], modules: ["mod-a"] },
		impactLevel: "normal",
		knowledgeClass: "semi_stable",
		consolidationTier: "semantic",
		confidence: 0.8,
		accessCount: 1,
		createdAt: new Date("2026-01-01T00:00:00Z"),
		updatedAt: new Date("2026-01-01T00:00:00Z"),
		createdBy: "test:direct-insert",
		trust: {
			score: 0.9,
			status: "validated",
			validatedAt: new Date("2026-01-01T00:00:00Z"),
			lastFailureAt: null,
		},
	} as unknown as MemoryEntry;
}

function buildCtx(entries: MemoryEntry[]): McpContext {
	const retrievalEngine = {
		retrieve: vi.fn().mockResolvedValue({
			entries,
			metadata: {
				totalCandidates: entries.length,
				filtered: 0,
				staleCount: 0,
				needsStaling: [],
				truncated: 0,
				tokensUsed: 0,
				level: "timeline",
				lowTrustMode: false,
			},
		}),
	};
	const entryRepo = {
		findByStatus: vi.fn().mockResolvedValue(entries),
		findById: vi.fn(async (id: string) => entries.find((e) => e.id === id) ?? null),
	};
	const evidenceRepo = { findByEntryId: vi.fn().mockResolvedValue([]) };
	const contradictionRepo = { findByEntryId: vi.fn().mockResolvedValue([]) };
	const embeddingChain = { embed: vi.fn().mockResolvedValue({ vector: [] }) };
	return {
		retrievalEngine,
		entryRepo,
		evidenceRepo,
		contradictionRepo,
		embeddingChain,
	} as unknown as McpContext;
}

describe("memory_retrieve — III2 output filter (direct-insert canary)", () => {
	for (const c of CANARIES) {
		it(`${c.pattern}: response is redacted and warning is emitted`, async () => {
			const entry = buildCanaryEntry(c.value, `entry-${c.pattern}`);
			const ctx = buildCtx([entry]);

			const result = await handleToolCall(
				"memory_retrieve",
				{ query: "anything", level: "L3" },
				ctx,
			);

			expect(result.isError).toBeFalsy();
			const body = (result.content[0] as { text: string }).text;
			expect(body, `${c.pattern}: raw canary value must not appear`).not.toContain(c.value);
			expect(body).toContain("[REDACTED:retrieve]");
			const parsed = JSON.parse(body) as {
				warnings?: Array<{ code: string; entryId: string; patterns: string[] }>;
			};
			expect(parsed.warnings?.length ?? 0).toBeGreaterThan(0);
			expect(parsed.warnings?.[0]?.code).toBe("RETRIEVE_POST_REDACT");
			expect(parsed.warnings?.[0]?.entryId).toBe(`entry-${c.pattern}`);
			// At least one pattern must have fired; the exact name can vary
			// when two catalog regexes match the same prefix (e.g. anthropic
			// keys also match the openai `sk-` shape). The security
			// invariant — redaction — is covered by the marker assertion
			// above. Label precision is a detection-quality concern.
			expect(parsed.warnings?.[0]?.patterns?.length ?? 0).toBeGreaterThan(0);
		});
	}
});

describe("memory_retrieve_details — III2 output filter", () => {
	for (const c of CANARIES) {
		it(`${c.pattern}: details handler redacts string fields and emits warning`, async () => {
			const entry = buildCanaryEntry(c.value, `det-${c.pattern}`);
			const ctx = buildCtx([entry]);

			const result = await handleToolCall("memory_retrieve_details", { ids: [entry.id] }, ctx);

			expect(result.isError).toBeFalsy();
			const body = (result.content[0] as { text: string }).text;
			expect(body, `${c.pattern}: raw canary value must not appear`).not.toContain(c.value);
			expect(body).toContain("[REDACTED:retrieve]");
			const parsed = JSON.parse(body) as {
				warnings?: Array<{ code: string; patterns: string[] }>;
			};
			expect(parsed.warnings?.[0]?.code).toBe("RETRIEVE_POST_REDACT");
			expect(parsed.warnings?.[0]?.patterns?.length ?? 0).toBeGreaterThan(0);
		});
	}
});

describe("memory_retrieve — clean input: no warnings field is attached", () => {
	it("envelope omits `warnings` when nothing was redacted", async () => {
		const clean = {
			...buildCanaryEntry("nothing suspicious", "clean-1"),
			summary: "completely clean",
		} as MemoryEntry;
		const ctx = buildCtx([clean]);
		const result = await handleToolCall("memory_retrieve", { query: "x" }, ctx);
		const body = JSON.parse((result.content[0] as { text: string }).text);
		expect(body.warnings).toBeUndefined();
	});
});
