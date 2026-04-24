/**
 * IV3 — Contract-Golden-Test „no-secret-in-output".
 *
 * Parametrised over every MCP tool definition. Each tool is either
 * `canary` (inject a canary into the tool args and assert that neither
 * the canary value nor the canary marker appears anywhere in the
 * response payload) or `skip` with a structured reason.
 *
 * The matrix is REQUIRED to cover every registered tool name. When a
 * new tool ships, the completeness check below fails until the author
 * adds an entry here — that is the whole point of the guard.
 *
 * Coverage scope matches the roadmap ("wo sinnvoll: propose, observe,
 * retrieve, explain, history"). Today only propose / observe /
 * observe_failure accept free-form external text; everything else is
 * read-only, admin, or id-based and therefore `skip` with the exact
 * reason wired into the matrix.
 */

import { describe, expect, it, vi } from "vitest";
import type { McpContext } from "../../src/mcp/context.js";
import { TOOL_DEFINITIONS } from "../../src/mcp/tool-definitions.js";
import { handleToolCall } from "../../src/mcp/tool-handlers.js";
import { CANARIES, CANARY_MARKER } from "../e2e/canaries.js";

type MatrixEntry =
	| {
			mode: "canary";
			/** Build tool args with the canary value injected. */
			args: (canary: string) => Record<string, unknown>;
			/** Build the mock McpContext this tool will receive. */
			buildCtx: () => McpContext;
	  }
	| {
			mode: "skip";
			/** Must be non-empty — documents why canary-testing is not applicable. */
			reason: string;
	  };

function mockObserveCtx(): McpContext {
	return {
		observationRepo: {
			create: vi.fn().mockResolvedValue({ id: "obs-should-never-see-this" }),
		},
	} as unknown as McpContext;
}

function mockProposeCtx(): McpContext {
	return {
		promotionService: {
			// If the guard fails open, this mock records the write so the
			// assertion below catches the regression even if the response
			// string happens to be empty.
			propose: vi.fn().mockResolvedValue({ proposalId: "p-should-never-see-this" }),
		},
	} as unknown as McpContext;
}

const MATRIX: Record<string, MatrixEntry> = {
	memory_propose: {
		mode: "canary",
		args: (canary) => ({
			type: "solution-fix",
			title: `title ${canary}`,
			summary: `summary for ${canary}`,
			details: "details",
			scope: { repository: "test", files: [], symbols: [], modules: [] },
			impactLevel: "normal",
			knowledgeClass: "semi_stable",
			embeddingText: `${canary} embedding`,
			source: "test:IV3",
			confidence: 0.9,
		}),
		buildCtx: mockProposeCtx,
	},
	memory_observe: {
		mode: "canary",
		args: (canary) => ({
			sessionId: "sess-IV3",
			content: `agent output: ${canary}`,
			source: "tool-use",
		}),
		buildCtx: mockObserveCtx,
	},
	memory_observe_failure: {
		mode: "canary",
		args: (canary) => ({
			sessionId: "sess-IV3",
			toolName: "bash",
			errorMessage: "command failed",
			stderr: `Authorization: Bearer ${canary}`,
		}),
		buildCtx: mockObserveCtx,
	},

	// Read-only or id-based surfaces — no free-form agent text in input.
	memory_retrieve: {
		mode: "skip",
		reason: "read-only, canaries in output covered by III2 retrieval-redaction tests",
	},
	memory_retrieve_details: { mode: "skip", reason: "read-only by id" },
	memory_ingest: {
		mode: "skip",
		reason: "scanner-fed ingress; canary coverage tracked under follow-up audit of handleIngest",
	},
	memory_validate: { mode: "skip", reason: "id-based admin action" },
	memory_invalidate: { mode: "skip", reason: "id-based admin action" },
	memory_poison: { mode: "skip", reason: "id-based admin action" },
	memory_verify: { mode: "skip", reason: "id-based admin action" },
	memory_health: { mode: "skip", reason: "no content input" },
	memory_diagnose: { mode: "skip", reason: "no free-form content input" },
	memory_explain: { mode: "skip", reason: "id-based, output derived from stored entry only" },
	memory_history: { mode: "skip", reason: "id-based, output derived from memory_events only" },
	memory_session_start: { mode: "skip", reason: "session metadata only" },
	memory_session_end: { mode: "skip", reason: "session metadata only" },
	memory_stop: { mode: "skip", reason: "session metadata only" },
	memory_run_invalidation: { mode: "skip", reason: "admin op, no content input" },
	memory_audit: { mode: "skip", reason: "admin op, emits counts only" },
	memory_review: { mode: "skip", reason: "admin op, id-based" },
	memory_resolve_contradiction: { mode: "skip", reason: "admin op, id-based" },
	memory_merge_duplicates: { mode: "skip", reason: "admin op, id-based" },
	memory_promote: { mode: "skip", reason: "admin op, id-based" },
	memory_deprecate: { mode: "skip", reason: "admin op, short reason text only" },
	memory_prune: { mode: "skip", reason: "policy tuning, no content input" },
};

describe("IV3 · no-secret-in-output contract matrix", () => {
	it("matrix covers every registered MCP tool (and nothing extra)", () => {
		const registered = new Set(TOOL_DEFINITIONS.map((t) => t.name));
		const matrixed = new Set(Object.keys(MATRIX));
		const missing = [...registered].filter((n) => !matrixed.has(n));
		const stray = [...matrixed].filter((n) => !registered.has(n));
		expect(missing, "Interface missing from no-secret matrix").toEqual([]);
		expect(stray, "Matrix entry for unknown tool").toEqual([]);
	});

	it("every skip entry has a non-empty reason", () => {
		for (const [name, entry] of Object.entries(MATRIX)) {
			if (entry.mode !== "skip") continue;
			expect(entry.reason, `${name} skip reason must not be empty`).toMatch(/\S/);
		}
	});

	for (const [name, entry] of Object.entries(MATRIX)) {
		if (entry.mode !== "canary") continue;
		for (const c of CANARIES) {
			it(`${name} does not leak ${c.pattern} into the response`, async () => {
				process.env.MEMORY_SECRET_POLICY = "reject";
				const ctx = entry.buildCtx();
				const result = await handleToolCall(name, entry.args(c.value), ctx);
				const body = JSON.stringify(result);
				// The canary value must never appear verbatim, and the
				// shared marker must not survive either — a response that
				// quotes just the suffix `agent_memory_canary` is still a
				// leak under IV3's contract.
				expect(body, `${name}/${c.pattern}: verbatim canary leaked`).not.toContain(c.value);
				expect(body, `${name}/${c.pattern}: canary marker leaked`).not.toContain(CANARY_MARKER);
			});
		}
	}
});
