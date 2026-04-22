import { describe, expect, it } from "vitest";
import {
	canPromoteEpisodicToSemantic,
	canPromoteSemanticToProcedural,
	canPromoteWorkingToEpisodic,
	evaluatePromotions,
	getNextTier,
	isTierHigherThan,
	TIER_TTL_DAYS,
} from "../../src/consolidation/tier-promotion.js";
import type { MemoryEntry } from "../../src/types.js";

function makeEntry(overrides: Partial<MemoryEntry> & { id: string }): MemoryEntry {
	return {
		id: overrides.id,
		type: "coding_convention",
		title: "Test entry",
		summary: "Test summary",
		details: null,
		scope: { repository: "test", files: [], symbols: [], modules: [] },
		impactLevel: "normal",
		knowledgeClass: "semi_stable",
		consolidationTier: "semantic",
		trust: {
			status: "validated",
			score: 0.8,
			validatedAt: new Date("2026-01-01"),
			expiresAt: new Date("2026-04-01"),
		},
		embeddingText: "test",
		embedding: null,
		accessCount: 0,
		lastAccessedAt: null,
		createdBy: "agent",
		createdInTask: null,
		createdAt: new Date("2026-01-01"),
		updatedAt: new Date("2026-01-01"),
		...overrides,
	};
}

describe("Tier Promotion", () => {
	describe("getNextTier", () => {
		it("working → episodic", () => expect(getNextTier("working")).toBe("episodic"));
		it("episodic → semantic", () => expect(getNextTier("episodic")).toBe("semantic"));
		it("semantic → procedural", () => expect(getNextTier("semantic")).toBe("procedural"));
		it("procedural → null (highest)", () => expect(getNextTier("procedural")).toBeNull());
	});

	describe("isTierHigherThan", () => {
		it("procedural > working", () => expect(isTierHigherThan("procedural", "working")).toBe(true));
		it("semantic > episodic", () => expect(isTierHigherThan("semantic", "episodic")).toBe(true));
		it("working is NOT > semantic", () =>
			expect(isTierHigherThan("working", "semantic")).toBe(false));
		it("same tier is NOT higher", () =>
			expect(isTierHigherThan("semantic", "semantic")).toBe(false));
	});

	describe("TIER_TTL_DAYS", () => {
		it("working has shortest TTL", () => expect(TIER_TTL_DAYS.working).toBe(1));
		it("procedural has longest TTL", () => expect(TIER_TTL_DAYS.procedural).toBe(90));
		it("TTLs increase monotonically", () => {
			expect(TIER_TTL_DAYS.working).toBeLessThan(TIER_TTL_DAYS.episodic);
			expect(TIER_TTL_DAYS.episodic).toBeLessThan(TIER_TTL_DAYS.semantic);
			expect(TIER_TTL_DAYS.semantic).toBeLessThan(TIER_TTL_DAYS.procedural);
		});
	});

	describe("canPromoteWorkingToEpisodic", () => {
		it("promotes validated working entries", () => {
			const entry = makeEntry({ id: "1", consolidationTier: "working" });
			expect(canPromoteWorkingToEpisodic(entry)).toBe(true);
		});

		it("rejects non-working entries", () => {
			const entry = makeEntry({ id: "1", consolidationTier: "episodic" });
			expect(canPromoteWorkingToEpisodic(entry)).toBe(false);
		});

		it("rejects quarantined working entries", () => {
			const entry = makeEntry({
				id: "1",
				consolidationTier: "working",
				trust: {
					status: "quarantine",
					score: 0,
					validatedAt: null,
					expiresAt: new Date("2026-04-01"),
				},
			});
			expect(canPromoteWorkingToEpisodic(entry)).toBe(false);
		});

		it("rejects stale working entries", () => {
			const entry = makeEntry({
				id: "1",
				consolidationTier: "working",
				trust: {
					status: "stale",
					score: 0.3,
					validatedAt: new Date(),
					expiresAt: new Date("2026-04-01"),
				},
			});
			expect(canPromoteWorkingToEpisodic(entry)).toBe(false);
		});
	});

	describe("canPromoteEpisodicToSemantic", () => {
		it("promotes validated episodic entries with access", () => {
			const entry = makeEntry({
				id: "1",
				consolidationTier: "episodic",
				accessCount: 2,
			});
			expect(canPromoteEpisodicToSemantic(entry)).toBe(true);
		});

		it("rejects episodic entries with zero access", () => {
			const entry = makeEntry({
				id: "1",
				consolidationTier: "episodic",
				accessCount: 0,
			});
			expect(canPromoteEpisodicToSemantic(entry)).toBe(false);
		});

		it("rejects non-episodic entries", () => {
			const entry = makeEntry({
				id: "1",
				consolidationTier: "working",
				accessCount: 5,
			});
			expect(canPromoteEpisodicToSemantic(entry)).toBe(false);
		});

		it("rejects non-validated episodic entries", () => {
			const entry = makeEntry({
				id: "1",
				consolidationTier: "episodic",
				accessCount: 3,
				trust: {
					status: "stale",
					score: 0.3,
					validatedAt: new Date(),
					expiresAt: new Date("2026-04-01"),
				},
			});
			expect(canPromoteEpisodicToSemantic(entry)).toBe(false);
		});
	});

	describe("canPromoteSemanticToProcedural", () => {
		it("promotes with 3+ validations", () => {
			const entry = makeEntry({ id: "1", consolidationTier: "semantic" });
			expect(canPromoteSemanticToProcedural(entry, 3)).toBe(true);
		});

		it("promotes with more than 3 validations", () => {
			const entry = makeEntry({ id: "1", consolidationTier: "semantic" });
			expect(canPromoteSemanticToProcedural(entry, 10)).toBe(true);
		});

		it("rejects with only 2 validations", () => {
			const entry = makeEntry({ id: "1", consolidationTier: "semantic" });
			expect(canPromoteSemanticToProcedural(entry, 2)).toBe(false);
		});

		it("rejects with 0 validations", () => {
			const entry = makeEntry({ id: "1", consolidationTier: "semantic" });
			expect(canPromoteSemanticToProcedural(entry, 0)).toBe(false);
		});

		it("rejects non-semantic entries even with 3+ validations", () => {
			const entry = makeEntry({ id: "1", consolidationTier: "episodic" });
			expect(canPromoteSemanticToProcedural(entry, 5)).toBe(false);
		});

		it("rejects non-validated semantic entries", () => {
			const entry = makeEntry({
				id: "1",
				consolidationTier: "semantic",
				trust: {
					status: "quarantine",
					score: 0,
					validatedAt: null,
					expiresAt: new Date("2026-04-01"),
				},
			});
			expect(canPromoteSemanticToProcedural(entry, 5)).toBe(false);
		});
	});

	describe("evaluatePromotions", () => {
		it("returns promotions for eligible entries across all tiers", () => {
			const entries = [
				makeEntry({ id: "w1", consolidationTier: "working" }),
				makeEntry({ id: "e1", consolidationTier: "episodic", accessCount: 3 }),
				makeEntry({ id: "s1", consolidationTier: "semantic" }),
				makeEntry({ id: "p1", consolidationTier: "procedural" }),
			];
			const validations = new Map([["s1", 5]]);

			const results = evaluatePromotions(entries, validations);
			expect(results).toHaveLength(3);
			expect(results.map((r) => r.entryId)).toEqual(["w1", "e1", "s1"]);
			expect(results[0]?.toTier).toBe("episodic");
			expect(results[1]?.toTier).toBe("semantic");
			expect(results[2]?.toTier).toBe("procedural");
		});

		it("returns empty array when nothing is promotable", () => {
			const entries = [
				makeEntry({ id: "e1", consolidationTier: "episodic", accessCount: 0 }), // no access
				makeEntry({ id: "s1", consolidationTier: "semantic" }), // no validations
				makeEntry({ id: "p1", consolidationTier: "procedural" }), // already top
			];
			const results = evaluatePromotions(entries);
			expect(results).toEqual([]);
		});

		it("skips entries with non-validated status", () => {
			const entries = [
				makeEntry({
					id: "w1",
					consolidationTier: "working",
					trust: {
						status: "quarantine",
						score: 0,
						validatedAt: null,
						expiresAt: new Date("2026-04-01"),
					},
				}),
			];
			expect(evaluatePromotions(entries)).toEqual([]);
		});

		it("defaults validation count to 0 when map has no entry", () => {
			const entries = [makeEntry({ id: "s1", consolidationTier: "semantic" })];
			const results = evaluatePromotions(entries, new Map());
			expect(results).toEqual([]);
		});
	});
});
