import type postgres from "postgres";
import { describe, expect, it, vi } from "vitest";
import {
	MemoryEventRepository,
	SECRET_EVENT_TYPES,
	TRUST_EVENT_TYPES,
} from "../../src/db/repositories/memory-event.repository.js";

type Handler = unknown | ((values: readonly unknown[]) => unknown);

/**
 * Minimal `postgres.Sql` mock. Matches on substring of the joined
 * template text, the same approach used by `tests/unit/migrate.test.ts`.
 * `sql.json` and `sql.array` are required by the repository — both are
 * stubbed as identity (value pass-through) since we assert on the
 * values the repo passes in, not on server-side parameter encoding.
 */
function mockSql(handlers: Record<string, Handler>): postgres.Sql {
	const fn = (strings: TemplateStringsArray, ...values: readonly unknown[]) => {
		const text = strings.join("?");
		for (const [needle, response] of Object.entries(handlers)) {
			if (text.includes(needle)) {
				const resolved = typeof response === "function" ? response(values) : response;
				return Promise.resolve(resolved);
			}
		}
		return Promise.resolve([]);
	};
	return fn as unknown as postgres.Sql;
}

describe("MemoryEventRepository.record", () => {
	it("persists the event and maps the returned row", async () => {
		const calls: unknown[][] = [];
		const sql = mockSql({
			"INSERT INTO memory_events": (values) => {
				calls.push([...values]);
				return [
					{
						id: "evt-1",
						entry_id: null,
						occurred_at: new Date("2026-01-01T00:00:00Z"),
						actor: "agent:mcp",
						event_type: "secret_rejected",
						metadata: { pattern: "GITHUB_TOKEN", ingress_path: "mcp_observe" },
					},
				];
			},
		});
		const repo = new MemoryEventRepository(sql);

		const event = await repo.record({
			actor: "agent:mcp",
			eventType: "secret_rejected",
			metadata: { pattern: "GITHUB_TOKEN", ingress_path: "mcp_observe" },
		});

		expect(event.id).toBe("evt-1");
		expect(event.entryId).toBeNull();
		expect(event.eventType).toBe("secret_rejected");
		expect(event.metadata).toEqual({ pattern: "GITHUB_TOKEN", ingress_path: "mcp_observe" });
		// INSERT parameter order: entryId, actor, eventType, metadata. The null
		// entryId guard is contract-critical — secret_rejected fires before any
		// entry exists.
		expect(calls[0]?.[0]).toBeNull();
		expect(calls[0]?.[1]).toBe("agent:mcp");
		expect(calls[0]?.[2]).toBe("secret_rejected");
	});

	it("defaults metadata to {} when omitted", async () => {
		const calls: unknown[][] = [];
		const sql = mockSql({
			"INSERT INTO memory_events": (values) => {
				calls.push([...values]);
				return [
					{
						id: "evt-2",
						entry_id: "e-1",
						occurred_at: new Date(),
						actor: "system:legacy_scan",
						event_type: "secret_detected_on_legacy_scan",
						metadata: {},
					},
				];
			},
		});
		const repo = new MemoryEventRepository(sql);
		await repo.record({
			entryId: "e-1",
			actor: "system:legacy_scan",
			eventType: "secret_detected_on_legacy_scan",
		});
		// Metadata is serialized to a JSON string at the bind site (matches
		// the project convention of `JSON.stringify(x)::jsonb`).
		expect(calls[0]?.[3]).toBe("{}");
	});
});

describe("MemoryEventRepository.countByTypeSince", () => {
	it("fills zero counts for event types with no rows", async () => {
		const sql = mockSql({
			"SELECT event_type, COUNT": [{ event_type: "secret_rejected", count: 3 }],
		});
		const repo = new MemoryEventRepository(sql);
		const counts = await repo.countByTypeSince(1440, SECRET_EVENT_TYPES);
		// All four secret event types must appear so consumers render a stable
		// table — missing types get count: 0 rather than being dropped.
		expect(counts).toHaveLength(SECRET_EVENT_TYPES.length);
		expect(counts.find((c) => c.eventType === "secret_rejected")?.count).toBe(3);
		expect(counts.find((c) => c.eventType === "secret_redacted")?.count).toBe(0);
	});
});

describe("migration 003_memory_events", () => {
	it("is registered in the MIGRATIONS array", async () => {
		const mod = await import("../../src/db/migrate.js");
		const sql = mockSql({
			"information_schema.tables": [{ exists: false }],
			"INSERT INTO memory_migrations": [],
		});
		const result = await mod.runMigrations({ sql });
		expect(result.applied).toContain("003_memory_events");
	});

	it("creates the table and required indices", async () => {
		const executed: string[] = [];
		const sql = vi.fn(async (strings: TemplateStringsArray) => {
			executed.push(strings.join("?"));
			return [];
		}) as unknown as postgres.Sql;
		const { up } = await import("../../src/db/migrations/003_memory_events.js");
		await up(sql);
		const joined = executed.join("\n");
		expect(joined).toMatch(/CREATE TABLE IF NOT EXISTS memory_events/);
		expect(joined).toMatch(/memory_events_entry_ts_idx/);
		expect(joined).toMatch(/memory_events_type_ts_idx/);
	});
});

describe("migration 004_memory_events_trust_extension (B4)", () => {
	it("is registered in the MIGRATIONS array", async () => {
		const mod = await import("../../src/db/migrate.js");
		const sql = mockSql({
			"information_schema.tables": [{ exists: false }],
			"INSERT INTO memory_migrations": [],
		});
		const result = await mod.runMigrations({ sql });
		expect(result.applied).toContain("004_memory_events_trust_extension");
	});

	it("adds before/after/reason columns via ALTER TABLE", async () => {
		const executed: string[] = [];
		const sql = vi.fn(async (strings: TemplateStringsArray) => {
			executed.push(strings.join("?"));
			return [];
		}) as unknown as postgres.Sql;
		const { up } = await import("../../src/db/migrations/004_memory_events_trust_extension.js");
		await up(sql);
		const joined = executed.join("\n");
		expect(joined).toMatch(/ALTER TABLE memory_events/);
		expect(joined).toMatch(/ADD COLUMN IF NOT EXISTS before jsonb/);
		expect(joined).toMatch(/ADD COLUMN IF NOT EXISTS after jsonb/);
		expect(joined).toMatch(/ADD COLUMN IF NOT EXISTS reason text/);
	});
});

describe("MemoryEventRepository — B4 trust audit", () => {
	it("exposes every trust-transition event type", () => {
		// Guard: B1 explain + B2 history depend on the exact union —
		// additions must be intentional, renames are breaking changes.
		expect(TRUST_EVENT_TYPES).toEqual([
			"entry_proposed",
			"entry_promoted",
			"entry_quarantined",
			"entry_stale",
			"entry_revived",
			"entry_deprecated",
			"entry_superseded",
			"entry_invalidated",
			"entry_archived",
			"review_accepted",
			"review_deferred",
			"review_skipped",
		]);
	});

	it("passes before/after/reason through to the INSERT", async () => {
		const calls: unknown[][] = [];
		const sql = mockSql({
			"INSERT INTO memory_events": (values) => {
				calls.push([...values]);
				return [
					{
						id: "evt-t1",
						entry_id: "e-1",
						occurred_at: new Date("2026-01-01T00:00:00Z"),
						actor: "system:promote",
						event_type: "entry_promoted",
						metadata: {},
						before: { status: "quarantine", score: 0.2 },
						after: { status: "validated", score: 0.8 },
						reason: "Gate passed",
					},
				];
			},
		});
		const repo = new MemoryEventRepository(sql);
		const event = await repo.record({
			entryId: "e-1",
			actor: "system:promote",
			eventType: "entry_promoted",
			before: { status: "quarantine", score: 0.2 },
			after: { status: "validated", score: 0.8 },
			reason: "Gate passed",
		});
		// INSERT positional args: entryId, actor, eventType, metadata,
		// before, after, reason (mirrors repository source order).
		expect(calls[0]?.[4]).toBe(JSON.stringify({ status: "quarantine", score: 0.2 }));
		expect(calls[0]?.[5]).toBe(JSON.stringify({ status: "validated", score: 0.8 }));
		expect(calls[0]?.[6]).toBe("Gate passed");
		expect(event.before).toEqual({ status: "quarantine", score: 0.2 });
		expect(event.after).toEqual({ status: "validated", score: 0.8 });
		expect(event.reason).toBe("Gate passed");
	});

	it("caps reason at 512 chars", async () => {
		const calls: unknown[][] = [];
		const sql = mockSql({
			"INSERT INTO memory_events": (values) => {
				calls.push([...values]);
				return [
					{
						id: "evt-t2",
						entry_id: "e-1",
						occurred_at: new Date(),
						actor: "system",
						event_type: "entry_stale",
						metadata: {},
						before: null,
						after: null,
						reason: null,
					},
				];
			},
		});
		const repo = new MemoryEventRepository(sql);
		const longReason = "x".repeat(700);
		await repo.record({
			entryId: "e-1",
			actor: "system",
			eventType: "entry_stale",
			reason: longReason,
		});
		expect((calls[0]?.[6] as string).length).toBe(512);
	});

	it("countByEntry groups by event type descending", async () => {
		const sql = mockSql({
			"WHERE entry_id =": [
				{ event_type: "entry_stale", count: 4 },
				{ event_type: "entry_revived", count: 2 },
			],
		});
		const repo = new MemoryEventRepository(sql);
		const counts = await repo.countByEntry("e-1");
		expect(counts).toEqual([
			{ eventType: "entry_stale", count: 4 },
			{ eventType: "entry_revived", count: 2 },
		]);
	});
});
