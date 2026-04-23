import type postgres from "postgres";
import { beforeEach, describe, expect, it, vi } from "vitest";

type Handler = unknown | ((values: readonly unknown[]) => unknown);

/**
 * Minimal `postgres.Sql` mock. Dispatches on substring match of the
 * concatenated template strings — the runMigrations body only inspects
 * a handful of distinct queries, and the migration `up()` functions just
 * need "some awaited promise" to succeed. Everything unmatched resolves
 * to `[]` so CREATE TABLE / CREATE INDEX / etc. are effectively no-ops.
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
	// `postgres.Sql` exposes helpers like `sql.end()` — only stub what runMigrations
	// and executeMigrations actually touch. end() is used in the databaseUrl path.
	(fn as unknown as { end: () => Promise<void> }).end = vi.fn(async () => undefined);
	return fn as unknown as postgres.Sql;
}

describe("runMigrations — sql option", () => {
	it("applies all pending migrations when the migrations table does not exist", async () => {
		const { runMigrations } = await import("../../src/db/migrate.js");
		const inserted: string[] = [];
		const sql = mockSql({
			"information_schema.tables": [{ exists: false }],
			"INSERT INTO memory_migrations": (values) => {
				inserted.push(values[0] as string);
				return [];
			},
		});

		const result = await runMigrations({ sql });

		expect(result.applied).toEqual(["001_initial", "002_promotion_metadata", "003_memory_events"]);
		expect(result.skipped).toEqual([]);
		expect(inserted).toEqual(["001_initial", "002_promotion_metadata", "003_memory_events"]);
	});

	it("is idempotent — skips every migration already recorded", async () => {
		const { runMigrations } = await import("../../src/db/migrate.js");
		const sql = mockSql({
			"information_schema.tables": [{ exists: true }],
			"SELECT name FROM memory_migrations": [
				{ name: "001_initial" },
				{ name: "002_promotion_metadata" },
				{ name: "003_memory_events" },
			],
		});

		const result = await runMigrations({ sql });

		expect(result.applied).toEqual([]);
		expect(result.skipped).toEqual(["001_initial", "002_promotion_metadata", "003_memory_events"]);
	});

	it("applies only the missing migrations when some already ran", async () => {
		const { runMigrations } = await import("../../src/db/migrate.js");
		const sql = mockSql({
			"information_schema.tables": [{ exists: true }],
			"SELECT name FROM memory_migrations": [{ name: "001_initial" }],
		});

		const result = await runMigrations({ sql });

		expect(result.applied).toEqual(["002_promotion_metadata", "003_memory_events"]);
		expect(result.skipped).toEqual(["001_initial"]);
	});

	it("propagates errors from a failing migration", async () => {
		const { runMigrations } = await import("../../src/db/migrate.js");
		const sql = mockSql({
			"information_schema.tables": [{ exists: false }],
			"CREATE EXTENSION IF NOT EXISTS vector": () => {
				throw new Error("pgvector missing");
			},
		});

		await expect(runMigrations({ sql })).rejects.toThrow(/pgvector missing/);
	});
});

describe("runMigrations — databaseUrl option", () => {
	beforeEach(() => {
		vi.resetModules();
	});

	it("opens a dedicated connection for the URL and closes it on completion", async () => {
		const endSpy = vi.fn(async () => undefined);
		const sqlTag = ((strings: TemplateStringsArray) => {
			const text = strings.join("?");
			if (text.includes("information_schema.tables")) {
				return Promise.resolve([{ exists: true }]);
			}
			if (text.includes("SELECT name FROM memory_migrations")) {
				return Promise.resolve([
					{ name: "001_initial" },
					{ name: "002_promotion_metadata" },
					{ name: "003_memory_events" },
				]);
			}
			return Promise.resolve([]);
		}) as unknown as postgres.Sql;
		(sqlTag as unknown as { end: () => Promise<void> }).end = endSpy;

		const postgresFactory = vi.fn(() => sqlTag);
		vi.doMock("postgres", () => ({ default: postgresFactory }));

		const { runMigrations } = await import("../../src/db/migrate.js");
		const result = await runMigrations({
			databaseUrl: "postgresql://u:p@example:5432/db",
		});

		expect(postgresFactory).toHaveBeenCalledWith(
			"postgresql://u:p@example:5432/db",
			expect.objectContaining({ max: 5 }),
		);
		expect(endSpy).toHaveBeenCalledTimes(1);
		expect(result.applied).toEqual([]);
		expect(result.skipped).toEqual(["001_initial", "002_promotion_metadata", "003_memory_events"]);
	});

	it("closes the dedicated connection even when a migration fails", async () => {
		const endSpy = vi.fn(async () => undefined);
		const sqlTag = ((strings: TemplateStringsArray) => {
			const text = strings.join("?");
			if (text.includes("information_schema.tables")) {
				return Promise.resolve([{ exists: false }]);
			}
			if (text.includes("CREATE EXTENSION IF NOT EXISTS vector")) {
				throw new Error("boom");
			}
			return Promise.resolve([]);
		}) as unknown as postgres.Sql;
		(sqlTag as unknown as { end: () => Promise<void> }).end = endSpy;

		vi.doMock("postgres", () => ({ default: vi.fn(() => sqlTag) }));

		const { runMigrations } = await import("../../src/db/migrate.js");

		await expect(
			runMigrations({ databaseUrl: "postgresql://u:p@example:5432/db" }),
		).rejects.toThrow(/boom/);
		expect(endSpy).toHaveBeenCalledTimes(1);
	});
});

describe("listPendingMigrations", () => {
	it("returns every known migration when the tracking table is absent", async () => {
		const { listPendingMigrations } = await import("../../src/db/migrate.js");
		const sql = mockSql({ "information_schema.tables": [{ exists: false }] });
		expect(await listPendingMigrations(sql)).toEqual([
			"001_initial",
			"002_promotion_metadata",
			"003_memory_events",
		]);
	});

	it("returns an empty list when every migration is recorded", async () => {
		const { listPendingMigrations } = await import("../../src/db/migrate.js");
		const sql = mockSql({
			"information_schema.tables": [{ exists: true }],
			"SELECT name FROM memory_migrations": [
				{ name: "001_initial" },
				{ name: "002_promotion_metadata" },
				{ name: "003_memory_events" },
			],
		});
		expect(await listPendingMigrations(sql)).toEqual([]);
	});

	it("returns only the still-missing migrations when the table is partial", async () => {
		const { listPendingMigrations } = await import("../../src/db/migrate.js");
		const sql = mockSql({
			"information_schema.tables": [{ exists: true }],
			"SELECT name FROM memory_migrations": [{ name: "001_initial" }],
		});
		expect(await listPendingMigrations(sql)).toEqual([
			"002_promotion_metadata",
			"003_memory_events",
		]);
	});
});

describe("buildMigrationStatus", () => {
	it("marks every known migration as pending when the tracking table is absent", async () => {
		const { buildMigrationStatus } = await import("../../src/db/migrate.js");
		const sql = mockSql({ "information_schema.tables": [{ exists: false }] });
		expect(await buildMigrationStatus(sql)).toEqual({
			applied: [],
			pending: ["001_initial", "002_promotion_metadata", "003_memory_events"],
			total: 3,
		});
	});

	it("reports every recorded migration as applied", async () => {
		const { buildMigrationStatus } = await import("../../src/db/migrate.js");
		const sql = mockSql({
			"information_schema.tables": [{ exists: true }],
			"SELECT name FROM memory_migrations": [
				{ name: "001_initial" },
				{ name: "002_promotion_metadata" },
				{ name: "003_memory_events" },
			],
		});
		expect(await buildMigrationStatus(sql)).toEqual({
			applied: ["001_initial", "002_promotion_metadata", "003_memory_events"],
			pending: [],
			total: 3,
		});
	});

	it("splits applied vs. pending and preserves the declared migration order", async () => {
		const { buildMigrationStatus } = await import("../../src/db/migrate.js");
		const sql = mockSql({
			"information_schema.tables": [{ exists: true }],
			"SELECT name FROM memory_migrations": [
				{ name: "003_memory_events" },
				{ name: "001_initial" },
			],
		});
		const status = await buildMigrationStatus(sql);
		expect(status.applied).toEqual(["001_initial", "003_memory_events"]);
		expect(status.pending).toEqual(["002_promotion_metadata"]);
		expect(status.total).toBe(3);
	});
});
