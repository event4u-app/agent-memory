import { describe, expect, it } from "vitest";
import type { MemoryEvent } from "../../src/db/repositories/memory-event.repository.js";
import { explainEntry } from "../../src/trust/explain.service.js";
import type {
	Contradiction,
	ImpactLevel,
	KnowledgeClass,
	MemoryEntry,
	TrustStatus,
} from "../../src/types.js";

function entry(overrides: Partial<MemoryEntry> = {}): MemoryEntry {
	return {
		id: "e-1",
		type: "architecture_decision",
		title: "t",
		summary: "s",
		details: null,
		scope: { repository: "r", files: [], symbols: [], modules: [] },
		impactLevel: "high" as ImpactLevel,
		knowledgeClass: "semi_stable" as KnowledgeClass,
		consolidationTier: "semantic",
		trust: {
			status: "validated" as TrustStatus,
			score: 0.7,
			validatedAt: new Date("2026-04-10T00:00:00.000Z"),
			expiresAt: new Date("2026-06-01T00:00:00.000Z"),
		},
		embeddingText: "t s",
		embedding: null,
		accessCount: 8,
		lastAccessedAt: null,
		createdBy: "agent",
		createdInTask: null,
		createdAt: new Date(),
		updatedAt: new Date(),
		promotionMetadata: {},
		...overrides,
	};
}

describe("explainEntry (B1)", () => {
	const now = new Date("2026-04-20T00:00:00.000Z"); // 10 days after validation

	it("computes all 5 sections for a typical validated entry", () => {
		const result = explainEntry({
			entry: entry(),
			evidenceCount: 2,
			events: [],
			contradictions: [],
			now,
		});
		expect(result.contract_version).toBe("explain-v1");
		expect(result.score.components.evidence.count).toBe(2);
		expect(result.score.components.evidence.contribution).toBeCloseTo(0.8, 2);
		expect(result.score.components.access_boost.contribution).toBeCloseTo(0.1, 3);
		expect(result.score.components.decay.penalty).toBe(0); // 10d < half of 30d TTL
		expect(result.score.components.single_evidence_cap.applied).toBe(false);
	});

	it("applies single-evidence cap and surfaces the reason", () => {
		const result = explainEntry({
			entry: entry({ impactLevel: "critical" }),
			evidenceCount: 1,
			events: [],
			contradictions: [],
			now,
		});
		expect(result.score.components.single_evidence_cap.applied).toBe(true);
		expect(result.score.components.single_evidence_cap.cap).toBeDefined();
		expect(result.score.why_not_max.join("\n")).toMatch(/single-evidence cap/);
	});

	it("surfaces decay penalty past half-life", () => {
		// semi_stable TTL = 30d; half-life = 15d → 20d since validation → decay
		const result = explainEntry({
			entry: entry({
				trust: {
					status: "validated",
					score: 0.5,
					validatedAt: new Date("2026-03-31T00:00:00.000Z"),
					expiresAt: new Date("2026-06-01T00:00:00.000Z"),
				},
			}),
			evidenceCount: 2,
			events: [],
			contradictions: [],
			now,
		});
		expect(result.score.components.decay.penalty).toBeGreaterThan(0);
		expect(result.score.why_not_max.some((w) => /past half-life/.test(w))).toBe(true);
	});

	it("sorts promotion history ascending by occurred_at", () => {
		const later: MemoryEvent = {
			id: "ev-2",
			entryId: "e-1",
			occurredAt: new Date("2026-02-01T00:00:00.000Z"),
			actor: "system:promote",
			eventType: "entry_promoted",
			metadata: {},
			before: { status: "quarantine" },
			after: { status: "validated" },
			reason: "gate passed",
		};
		const earlier: MemoryEvent = {
			...later,
			id: "ev-1",
			occurredAt: new Date("2026-01-10T00:00:00.000Z"),
			eventType: "entry_proposed",
			reason: "init",
		};
		const result = explainEntry({
			entry: entry(),
			evidenceCount: 2,
			events: [later, earlier], // unsorted input
			contradictions: [],
			now,
		});
		expect(result.promotion_history.map((h) => h.event_type)).toEqual([
			"entry_proposed",
			"entry_promoted",
		]);
	});

	it("flags stale_at_current_rate when expires_at is in the past", () => {
		const result = explainEntry({
			entry: entry({
				trust: {
					status: "stale",
					score: 0.3,
					validatedAt: new Date("2026-01-01T00:00:00.000Z"),
					expiresAt: new Date("2026-04-01T00:00:00.000Z"), // past
				},
			}),
			evidenceCount: 2,
			events: [],
			contradictions: [],
			now,
		});
		expect(result.decay.stale_at_current_rate).toBe(true);
		expect(result.decay.days_until_expiry).toBeLessThanOrEqual(0);
	});

	it("includes contradictions with resolved flag", () => {
		const c: Contradiction = {
			id: "c-1",
			entryAId: "e-1",
			entryBId: "e-2",
			description: "conflict",
			resolvedAt: null,
			resolution: null,
			createdAt: new Date(),
		};
		const result = explainEntry({
			entry: entry(),
			evidenceCount: 2,
			events: [],
			contradictions: [c],
			now,
		});
		expect(result.contradictions).toEqual([
			{ id: "c-1", description: "conflict", resolved: false },
		]);
	});
});
