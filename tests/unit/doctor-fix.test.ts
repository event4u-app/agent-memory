// A1 · runtime-trust — `memory doctor --fix` repair contract.
//
// Exercises `runRepairs` directly with a mock check-set. The full
// `runDoctor({ fix: true })` flow requires a reachable Postgres and
// is covered by the CLI smoke in tests/e2e; this file isolates the
// repair-decision logic so regressions are caught without DB setup.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DoctorCheck } from "../../src/cli/doctor.js";

const runMigrationsMock = vi.fn();
const createExtensionMock = vi.fn();
const closeDbMock = vi.fn(async () => {});

vi.mock("../../src/db/migrate.js", () => ({
	runMigrations: (...args: unknown[]) => runMigrationsMock(...args),
}));

vi.mock("../../src/db/connection.js", () => ({
	getDb: () => {
		const fn = (strings: TemplateStringsArray) => {
			const text = strings.join("?");
			return createExtensionMock(text);
		};
		return fn;
	},
	closeDb: () => closeDbMock(),
	// runRepairs also imports healthCheck transitively through doctor.ts
	// (for the diagnosis phase, not the repair phase). Provide a stub so
	// the module graph resolves.
	healthCheck: async () => ({ status: "ok" }),
}));

beforeEach(() => {
	runMigrationsMock.mockReset();
	createExtensionMock.mockReset();
	closeDbMock.mockClear();
});

afterEach(() => {
	vi.clearAllMocks();
});

function mkChecks(overrides: Partial<Record<string, DoctorCheck>> = {}): DoctorCheck[] {
	const base: Record<string, DoctorCheck> = {
		"db.connect": { name: "db.connect", status: "ok", message: "ok" },
		"db.pgvector": { name: "db.pgvector", status: "ok", message: "ok" },
		"db.migrations": { name: "db.migrations", status: "ok", message: "ok" },
	};
	return Object.values({ ...base, ...overrides });
}

describe("runRepairs", () => {
	it("returns a single 'skipped' fix when the database is unreachable", async () => {
		const { runRepairs } = await import("../../src/cli/doctor.js");
		const fixes = await runRepairs(
			mkChecks({
				"db.connect": { name: "db.connect", status: "fail", message: "ECONNREFUSED" },
			}),
		);
		expect(fixes).toEqual([
			{
				target: "db.connect",
				status: "skipped",
				message: "Cannot repair without a reachable database.",
			},
		]);
		expect(runMigrationsMock).not.toHaveBeenCalled();
		expect(createExtensionMock).not.toHaveBeenCalled();
	});

	it("returns an empty list when every target check is healthy", async () => {
		const { runRepairs } = await import("../../src/cli/doctor.js");
		const fixes = await runRepairs(mkChecks());
		expect(fixes).toEqual([]);
		expect(runMigrationsMock).not.toHaveBeenCalled();
		expect(createExtensionMock).not.toHaveBeenCalled();
	});

	it("creates the pgvector extension when db.pgvector has failed", async () => {
		createExtensionMock.mockResolvedValue([]);
		const { runRepairs } = await import("../../src/cli/doctor.js");
		const fixes = await runRepairs(
			mkChecks({
				"db.pgvector": { name: "db.pgvector", status: "fail", message: "missing" },
			}),
		);
		expect(createExtensionMock).toHaveBeenCalledTimes(1);
		expect(createExtensionMock.mock.calls[0][0]).toContain("CREATE EXTENSION IF NOT EXISTS vector");
		expect(fixes).toEqual([
			{
				target: "db.pgvector",
				status: "applied",
				message: "CREATE EXTENSION IF NOT EXISTS vector",
			},
		]);
	});

	it("captures the pgvector failure without aborting the next fix", async () => {
		createExtensionMock.mockRejectedValueOnce(new Error("permission denied"));
		runMigrationsMock.mockResolvedValue({ applied: ["001_initial"], skipped: [] });
		const { runRepairs } = await import("../../src/cli/doctor.js");
		const fixes = await runRepairs(
			mkChecks({
				"db.pgvector": { name: "db.pgvector", status: "fail", message: "missing" },
				"db.migrations": { name: "db.migrations", status: "fail", message: "pending" },
			}),
		);
		expect(fixes[0]).toEqual({
			target: "db.pgvector",
			status: "failed",
			message: "permission denied",
		});
		expect(fixes[1]).toMatchObject({
			target: "db.migrations",
			status: "applied",
		});
		expect(runMigrationsMock).toHaveBeenCalledTimes(1);
	});

	it("runs pending migrations when db.migrations has failed", async () => {
		runMigrationsMock.mockResolvedValue({
			applied: ["002_promotion_metadata", "003_memory_events"],
			skipped: ["001_initial"],
		});
		const { runRepairs } = await import("../../src/cli/doctor.js");
		const fixes = await runRepairs(
			mkChecks({
				"db.migrations": { name: "db.migrations", status: "fail", message: "pending" },
			}),
		);
		expect(runMigrationsMock).toHaveBeenCalledTimes(1);
		expect(fixes).toEqual([
			{
				target: "db.migrations",
				status: "applied",
				message: "Applied 2 migration(s).",
				detail: {
					applied: ["002_promotion_metadata", "003_memory_events"],
					skipped: ["001_initial"],
				},
			},
		]);
	});
});
