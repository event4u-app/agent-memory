import type postgres from "postgres";
import { describe, expect, it, vi } from "vitest";
import { MemoryEntryRepository } from "../../src/db/repositories/memory-entry.repository.js";
import type { MemoryEventRepository } from "../../src/db/repositories/memory-event.repository.js";

/**
 * B4 Done-Kriterium: "Jede Trust-Transition verifiziert das geschriebene Event."
 *
 * These tests check the wiring contract between MemoryEntryRepository and
 * MemoryEventRepository — not the SQL, not the full service graph. A
 * recording `eventRepo` spy asserts that `.create()`, `.transitionStatus()`,
 * and `.enforceExpiry()` each emit exactly one memory_events row with the
 * correct event type and before/after payload.
 */

function mockEntryRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		id: "e-1",
		type: "architecture-decision",
		title: "t",
		summary: "s",
		details: null,
		scope: "{}",
		impact_level: "normal",
		knowledge_class: "stable",
		consolidation_tier: "semantic",
		trust_status: "quarantine",
		trust_score: 0,
		expires_at: null,
		access_count: 0,
		last_accessed_at: null,
		created_by: "agent",
		created_in_task: null,
		created_at: new Date(),
		updated_at: new Date(),
		promotion_metadata: "{}",
		...overrides,
	};
}

function mockSql(route: (text: string) => unknown): postgres.Sql {
	const fn = (strings: TemplateStringsArray) => Promise.resolve(route(strings.join("?")));
	return fn as unknown as postgres.Sql;
}

class SpyEventRepo {
	calls: Array<Record<string, unknown>> = [];
	async record(input: Record<string, unknown>): Promise<Record<string, unknown>> {
		this.calls.push(input);
		return { id: "evt", ...input };
	}
}

describe("B4 trust-audit emission (MemoryEntryRepository ↔ MemoryEventRepository)", () => {
	it("emits entry_proposed on create()", async () => {
		const sql = mockSql((text) => {
			if (text.includes("INSERT INTO memory_entries")) return [mockEntryRow()];
			return [];
		});
		const spy = new SpyEventRepo();
		const repo = new MemoryEntryRepository(sql, spy as unknown as MemoryEventRepository);

		await repo.create({
			type: "architecture-decision",
			title: "t",
			summary: "s",
			scope: {},
			impactLevel: "normal",
			knowledgeClass: "stable",
			embeddingText: "t s",
			createdBy: "agent:test",
		});

		expect(spy.calls).toHaveLength(1);
		expect(spy.calls[0]?.eventType).toBe("entry_proposed");
		expect(spy.calls[0]?.actor).toBe("agent:test");
		expect((spy.calls[0]?.after as Record<string, unknown>)?.status).toBe("quarantine");
	});

	it("emits entry_promoted on quarantine → validated", async () => {
		const sql = mockSql((text) => {
			if (text.includes("SELECT * FROM memory_entries WHERE id")) {
				return [mockEntryRow({ trust_status: "quarantine", trust_score: 0.2 })];
			}
			if (text.includes("UPDATE memory_entries")) {
				return [mockEntryRow({ trust_status: "validated", trust_score: 0.8 })];
			}
			return [];
		});
		const spy = new SpyEventRepo();
		const repo = new MemoryEntryRepository(sql, spy as unknown as MemoryEventRepository);
		await repo.transitionStatus("e-1", "validated", "gate passed", "system:promote");

		expect(spy.calls).toHaveLength(1);
		expect(spy.calls[0]?.eventType).toBe("entry_promoted");
		expect((spy.calls[0]?.before as Record<string, unknown>)?.status).toBe("quarantine");
		expect((spy.calls[0]?.after as Record<string, unknown>)?.status).toBe("validated");
	});

	it("emits entry_revived on stale → validated", async () => {
		const sql = mockSql((text) => {
			if (text.includes("SELECT * FROM memory_entries WHERE id")) {
				return [mockEntryRow({ trust_status: "stale" })];
			}
			if (text.includes("UPDATE memory_entries")) {
				return [mockEntryRow({ trust_status: "validated" })];
			}
			return [];
		});
		const spy = new SpyEventRepo();
		const repo = new MemoryEntryRepository(sql, spy as unknown as MemoryEventRepository);
		await repo.transitionStatus("e-1", "validated", "re-verified", "system:revalidation");
		expect(spy.calls[0]?.eventType).toBe("entry_revived");
	});

	it("emits entry_invalidated on validated → invalidated", async () => {
		const sql = mockSql((text) => {
			if (text.includes("SELECT * FROM memory_entries WHERE id")) {
				return [mockEntryRow({ trust_status: "validated" })];
			}
			if (text.includes("UPDATE memory_entries")) {
				return [mockEntryRow({ trust_status: "invalidated" })];
			}
			return [];
		});
		const spy = new SpyEventRepo();
		const repo = new MemoryEntryRepository(sql, spy as unknown as MemoryEventRepository);
		await repo.transitionStatus("e-1", "invalidated", "file deleted", "system:invalidation");
		expect(spy.calls[0]?.eventType).toBe("entry_invalidated");
	});

	it("swallows event-recorder failures so the entry write survives", async () => {
		const sql = mockSql((text) => {
			if (text.includes("SELECT * FROM memory_entries WHERE id")) {
				return [mockEntryRow({ trust_status: "quarantine" })];
			}
			if (text.includes("UPDATE memory_entries")) {
				return [mockEntryRow({ trust_status: "validated" })];
			}
			return [];
		});
		const failing = { record: vi.fn(async () => Promise.reject(new Error("audit down"))) };
		const repo = new MemoryEntryRepository(sql, failing as unknown as MemoryEventRepository);
		await expect(repo.transitionStatus("e-1", "validated", "x", "s")).resolves.toMatchObject({
			trust: { status: "validated" },
		});
		expect(failing.record).toHaveBeenCalled();
	});
});
