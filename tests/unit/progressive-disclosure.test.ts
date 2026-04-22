import { describe, expect, it } from "vitest";
import {
	applyTokenBudget,
	estimateTokens,
	project,
	toL1,
	toL2,
	toL3,
} from "../../src/retrieval/progressive-disclosure.js";
import type { MemoryEntry } from "../../src/types.js";

function makeEntry(id: string): MemoryEntry {
	return {
		id,
		type: "coding_convention",
		title: `Entry ${id}`,
		summary: `Summary for ${id} with some content`,
		details: `Detailed information for ${id} including many specifics and examples`,
		scope: {
			repository: "test-repo",
			files: ["src/foo.ts"],
			symbols: ["MyClass"],
			modules: ["core"],
		},
		impactLevel: "normal",
		knowledgeClass: "semi_stable",
		consolidationTier: "semantic",
		trust: {
			status: "validated",
			score: 0.85,
			validatedAt: new Date("2026-01-15"),
			expiresAt: new Date("2026-04-15"),
		},
		embeddingText: "entry embedding text for search",
		embedding: null,
		accessCount: 5,
		lastAccessedAt: new Date("2026-03-01"),
		createdBy: "agent",
		createdInTask: "task-123",
		createdAt: new Date("2026-01-01"),
		updatedAt: new Date("2026-02-01"),
	};
}

describe("Progressive Disclosure", () => {
	describe("toL1", () => {
		it("extracts minimal index data", () => {
			const l1 = toL1(makeEntry("1"));
			expect(l1).toEqual({
				id: "1",
				title: "Entry 1",
				type: "coding_convention",
				consolidationTier: "semantic",
				trustScore: 0.85,
				trustStatus: "validated",
				isStale: false,
			});
		});

		it("marks stale entries", () => {
			const entry = makeEntry("1");
			entry.trust.status = "stale";
			expect(toL1(entry).isStale).toBe(true);
		});
	});

	describe("toL2", () => {
		it("includes summary and scope", () => {
			const l2 = toL2(makeEntry("1"));
			expect(l2.summary).toBe("Summary for 1 with some content");
			expect(l2.scope.repository).toBe("test-repo");
			expect(l2.scope.modules).toEqual(["core"]);
			expect(l2.accessCount).toBe(5);
			// L2 should NOT include files/symbols
			expect((l2 as any).details).toBeUndefined();
		});
	});

	describe("toL3", () => {
		it("includes everything", () => {
			const l3 = toL3(makeEntry("1"));
			expect(l3.details).toContain("Detailed information");
			expect(l3.embeddingText).toBe("entry embedding text for search");
			expect(l3.scope.files).toEqual(["src/foo.ts"]);
			expect(l3.scope.symbols).toEqual(["MyClass"]);
			expect(l3.createdBy).toBe("agent");
			expect(l3.createdInTask).toBe("task-123");
		});
	});

	describe("project", () => {
		it("projects at L1 level", () => {
			const entries = [makeEntry("1"), makeEntry("2")];
			const result = project(entries, "index");
			expect(result).toHaveLength(2);
			expect((result[0] as any).summary).toBeUndefined();
		});

		it("projects at L2 level", () => {
			const entries = [makeEntry("1")];
			const result = project(entries, "timeline");
			expect((result[0] as any).summary).toBeDefined();
			expect((result[0] as any).details).toBeUndefined();
		});

		it("projects at L3 level", () => {
			const entries = [makeEntry("1")];
			const result = project(entries, "full");
			expect((result[0] as any).details).toBeDefined();
		});
	});

	describe("estimateTokens", () => {
		it("estimates tokens from JSON length", () => {
			const l1 = toL1(makeEntry("1"));
			const tokens = estimateTokens(l1);
			expect(tokens).toBeGreaterThan(0);
			expect(tokens).toBeLessThan(200); // L1 should be compact
		});

		it("L3 uses more tokens than L1", () => {
			const entry = makeEntry("1");
			const l1Tokens = estimateTokens(toL1(entry));
			const l3Tokens = estimateTokens(toL3(entry));
			expect(l3Tokens).toBeGreaterThan(l1Tokens);
		});
	});

	describe("applyTokenBudget", () => {
		it("includes entries within budget", () => {
			const entries = [toL1(makeEntry("1")), toL1(makeEntry("2"))];
			const result = applyTokenBudget(entries, 10000);
			expect(result.included).toHaveLength(2);
			expect(result.truncated).toBe(0);
		});

		it("truncates when budget exceeded", () => {
			const entries = Array.from({ length: 100 }, (_, i) => toL1(makeEntry(`${i}`)));
			const result = applyTokenBudget(entries, 200); // Very small budget
			expect(result.included.length).toBeLessThan(100);
			expect(result.truncated).toBeGreaterThan(0);
		});

		it("always includes at least 1 entry", () => {
			const entries = [toL1(makeEntry("big"))];
			const result = applyTokenBudget(entries, 1); // Tiny budget
			expect(result.included).toHaveLength(1);
		});

		it("handles empty input", () => {
			const result = applyTokenBudget([], 2000);
			expect(result.included).toEqual([]);
			expect(result.truncated).toBe(0);
			expect(result.tokensUsed).toBe(0);
		});
	});
});
