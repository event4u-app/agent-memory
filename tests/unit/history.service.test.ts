import { describe, expect, it } from "vitest";
import type { MemoryEvent } from "../../src/db/repositories/memory-event.repository.js";
import { buildHistory, classifyActor } from "../../src/trust/history.service.js";
import type { ImpactLevel, KnowledgeClass, MemoryEntry, TrustStatus } from "../../src/types.js";

function entry(overrides: Partial<MemoryEntry> = {}): MemoryEntry {
	return {
		id: "mem_h",
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
		accessCount: 0,
		lastAccessedAt: null,
		createdBy: "agent",
		createdInTask: null,
		createdAt: new Date(),
		updatedAt: new Date(),
		promotionMetadata: {},
		...overrides,
	};
}

function ev(
	id: string,
	iso: string,
	actor: string,
	eventType: MemoryEvent["eventType"],
	before: Record<string, unknown> | null = null,
	after: Record<string, unknown> | null = null,
	reason: string | null = null,
): MemoryEvent {
	return {
		id,
		entryId: "mem_h",
		occurredAt: new Date(iso),
		actor,
		eventType,
		metadata: {},
		before,
		after,
		reason,
	};
}

describe("buildHistory (B2)", () => {
	const now = new Date("2026-04-20T00:00:00.000Z");

	it("envelope carries contract_version, entry snapshot and range", () => {
		const h = buildHistory({ entry: entry(), events: [], now });
		expect(h.contract_version).toBe("history-v1");
		expect(h.entry).toEqual({
			id: "mem_h",
			title: "t",
			type: "architecture_decision",
			status: "validated",
			current_score: 0.7,
		});
		expect(h.range.until).toBe(now.toISOString());
		expect(h.range.since).toBeNull();
		expect(h.range.event_count).toBe(0);
		expect(h.timeline).toEqual([]);
	});

	it("groups events by UTC day in ascending order", () => {
		const events = [
			ev("e1", "2026-01-10T09:00:00.000Z", "agent:x", "entry_proposed"),
			ev("e3", "2026-02-15T16:00:00.000Z", "system:ttl", "entry_stale"),
			ev("e2", "2026-01-10T23:00:00.000Z", "user:a", "entry_promoted"),
		];
		const h = buildHistory({ entry: entry(), events, now });
		expect(h.timeline.map((d) => d.day)).toEqual(["2026-01-10", "2026-02-15"]);
		expect(h.timeline[0].events.map((e) => e.id)).toEqual(["e1", "e2"]);
		expect(h.timeline[1].events.map((e) => e.id)).toEqual(["e3"]);
	});

	it("extracts status and score diffs from before/after", () => {
		const events = [
			ev(
				"e1",
				"2026-01-10T09:00:00.000Z",
				"system:promote",
				"entry_promoted",
				{ status: "quarantine", score: 0.5 },
				{ status: "validated", score: 0.73 },
				"gates passed",
			),
		];
		const h = buildHistory({ entry: entry(), events, now });
		const out = h.timeline[0].events[0];
		expect(out.diff.status).toEqual({ before: "quarantine", after: "validated" });
		expect(out.diff.score).toEqual({ before: 0.5, after: 0.73 });
		expect(out.reason).toBe("gates passed");
	});

	it("omits diff keys when no relevant field changed", () => {
		const events = [ev("e1", "2026-01-10T09:00:00.000Z", "agent:x", "entry_proposed")];
		const h = buildHistory({ entry: entry(), events, now });
		expect(h.timeline[0].events[0].diff).toEqual({});
	});

	it("classifies actor kinds by prefix", () => {
		expect(classifyActor("user:alice")).toBe("user");
		expect(classifyActor("agent:pr-bot")).toBe("agent");
		expect(classifyActor("system:ttl")).toBe("system");
		expect(classifyActor("foo")).toBe("unknown");
	});

	it("carries since into range.since when provided", () => {
		const since = new Date("2026-02-01T00:00:00.000Z");
		const h = buildHistory({ entry: entry(), events: [], since, now });
		expect(h.range.since).toBe(since.toISOString());
	});

	it("does not mutate caller-supplied events array", () => {
		const events = [
			ev("e2", "2026-02-10T00:00:00.000Z", "agent:x", "entry_stale"),
			ev("e1", "2026-01-10T00:00:00.000Z", "agent:x", "entry_proposed"),
		];
		const originalOrder = events.map((e) => e.id);
		buildHistory({ entry: entry(), events, now });
		expect(events.map((e) => e.id)).toEqual(originalOrder);
	});

	it("handles 1000 events fast (perf sanity, < 100ms wall)", () => {
		const events: MemoryEvent[] = [];
		for (let i = 0; i < 1000; i++) {
			const day = String(10 + (i % 20)).padStart(2, "0");
			events.push(ev(`e${i}`, `2026-01-${day}T00:00:00.000Z`, "agent:x", "entry_proposed"));
		}
		const start = performance.now();
		const h = buildHistory({ entry: entry(), events, now });
		const elapsed = performance.now() - start;
		expect(h.range.event_count).toBe(1000);
		expect(elapsed).toBeLessThan(100);
	});
});
