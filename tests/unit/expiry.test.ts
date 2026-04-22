import { describe, expect, it } from "vitest";
import { applyExpiryFilter, findExpiredEntries, isExpired } from "../../src/trust/expiry.js";
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
			expiresAt: new Date("2026-02-01"),
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

describe("TTL Expiry", () => {
	const now = new Date("2026-03-01"); // After the default expiresAt of Feb 1

	describe("isExpired", () => {
		it("returns true when expires_at is in the past", () => {
			const entry = makeEntry({ id: "1" });
			expect(isExpired(entry, now)).toBe(true);
		});

		it("returns false when expires_at is in the future", () => {
			const entry = makeEntry({
				id: "1",
				trust: {
					status: "validated",
					score: 0.8,
					validatedAt: new Date("2026-01-01"),
					expiresAt: new Date("2026-04-01"),
				},
			});
			expect(isExpired(entry, now)).toBe(false);
		});

		it("returns true when expires_at equals now (boundary)", () => {
			const entry = makeEntry({
				id: "1",
				trust: {
					status: "validated",
					score: 0.8,
					validatedAt: new Date("2026-01-01"),
					expiresAt: now,
				},
			});
			// expiresAt < now is false when equal, so NOT expired at exact boundary
			expect(isExpired(entry, now)).toBe(false);
		});
	});

	describe("findExpiredEntries", () => {
		it("returns IDs of expired validated entries", () => {
			const entries = [
				makeEntry({ id: "expired-1" }),
				makeEntry({
					id: "fresh-1",
					trust: {
						status: "validated",
						score: 0.8,
						validatedAt: new Date(),
						expiresAt: new Date("2026-04-01"),
					},
				}),
				makeEntry({ id: "expired-2" }),
			];
			const ids = findExpiredEntries(entries, now);
			expect(ids).toEqual(["expired-1", "expired-2"]);
		});

		it("skips entries in statuses that cannot transition to stale", () => {
			const entries = [
				makeEntry({
					id: "quarantined",
					trust: {
						status: "quarantine",
						score: 0,
						validatedAt: null,
						expiresAt: new Date("2026-01-01"),
					},
				}),
				makeEntry({
					id: "rejected",
					trust: {
						status: "rejected",
						score: 0,
						validatedAt: null,
						expiresAt: new Date("2026-01-01"),
					},
				}),
				makeEntry({
					id: "archived",
					trust: {
						status: "archived",
						score: 0,
						validatedAt: null,
						expiresAt: new Date("2026-01-01"),
					},
				}),
			];
			const ids = findExpiredEntries(entries, now);
			expect(ids).toEqual([]);
		});

		it("includes already-stale expired entries that can re-stale", () => {
			// stale → stale is NOT a valid transition (stale → validated or stale → invalidated)
			const entries = [
				makeEntry({
					id: "stale-1",
					trust: {
						status: "stale",
						score: 0.4,
						validatedAt: new Date("2025-01-01"),
						expiresAt: new Date("2026-01-01"),
					},
				}),
			];
			const ids = findExpiredEntries(entries, now);
			// stale → stale is not valid, so should be empty
			expect(ids).toEqual([]);
		});

		it("returns empty array when no entries are expired", () => {
			const entries = [
				makeEntry({
					id: "fresh",
					trust: {
						status: "validated",
						score: 0.9,
						validatedAt: new Date(),
						expiresAt: new Date("2026-12-31"),
					},
				}),
			];
			const ids = findExpiredEntries(entries, now);
			expect(ids).toEqual([]);
		});
	});

	describe("applyExpiryFilter", () => {
		it("separates servable from stale entries", () => {
			const entries = [
				makeEntry({
					id: "fresh",
					trust: {
						status: "validated",
						score: 0.9,
						validatedAt: new Date(),
						expiresAt: new Date("2026-04-01"),
					},
				}),
				makeEntry({
					id: "stale",
					trust: {
						status: "stale",
						score: 0.4,
						validatedAt: new Date("2025-01-01"),
						expiresAt: new Date("2026-01-01"),
					},
				}),
			];
			const result = applyExpiryFilter(entries, now);
			expect(result.servable).toHaveLength(1);
			expect(result.servable[0]?.id).toBe("fresh");
			expect(result.staleWarning).toHaveLength(1);
			expect(result.staleWarning[0]?.id).toBe("stale");
		});

		it("detects expired validated entries and marks them for staling", () => {
			const entries = [makeEntry({ id: "expired-validated" })]; // default expiresAt is Feb 1, now is Mar 1
			const result = applyExpiryFilter(entries, now);
			expect(result.servable).toHaveLength(0);
			expect(result.staleWarning).toHaveLength(1);
			expect(result.needsStaling).toEqual(["expired-validated"]);
		});

		it("filters out non-servable statuses", () => {
			const entries = [
				makeEntry({
					id: "q",
					trust: {
						status: "quarantine",
						score: 0,
						validatedAt: null,
						expiresAt: new Date("2026-04-01"),
					},
				}),
				makeEntry({
					id: "i",
					trust: {
						status: "invalidated",
						score: 0,
						validatedAt: null,
						expiresAt: new Date("2026-04-01"),
					},
				}),
				makeEntry({
					id: "r",
					trust: {
						status: "rejected",
						score: 0,
						validatedAt: null,
						expiresAt: new Date("2026-04-01"),
					},
				}),
				makeEntry({
					id: "p",
					trust: {
						status: "poisoned",
						score: 0,
						validatedAt: null,
						expiresAt: new Date("2026-04-01"),
					},
				}),
				makeEntry({
					id: "a",
					trust: {
						status: "archived",
						score: 0,
						validatedAt: null,
						expiresAt: new Date("2026-04-01"),
					},
				}),
			];
			const result = applyExpiryFilter(entries, now);
			expect(result.servable).toHaveLength(0);
			expect(result.staleWarning).toHaveLength(0);
			expect(result.filtered).toBe(5);
		});

		it("handles mixed bag correctly", () => {
			const entries = [
				makeEntry({
					id: "valid-fresh",
					trust: {
						status: "validated",
						score: 0.9,
						validatedAt: new Date(),
						expiresAt: new Date("2026-12-31"),
					},
				}),
				makeEntry({ id: "valid-expired" }), // expires Feb 1
				makeEntry({
					id: "already-stale",
					trust: {
						status: "stale",
						score: 0.3,
						validatedAt: new Date("2025-01-01"),
						expiresAt: new Date("2025-06-01"),
					},
				}),
				makeEntry({
					id: "quarantined",
					trust: {
						status: "quarantine",
						score: 0,
						validatedAt: null,
						expiresAt: new Date("2026-04-01"),
					},
				}),
				makeEntry({
					id: "poisoned",
					trust: {
						status: "poisoned",
						score: 0,
						validatedAt: null,
						expiresAt: new Date("2026-04-01"),
					},
				}),
			];
			const result = applyExpiryFilter(entries, now);
			expect(result.servable).toHaveLength(1);
			expect(result.servable[0]?.id).toBe("valid-fresh");
			expect(result.staleWarning).toHaveLength(2); // valid-expired + already-stale
			expect(result.needsStaling).toEqual(["valid-expired"]);
			expect(result.filtered).toBe(2); // quarantined + poisoned
		});
	});
});
