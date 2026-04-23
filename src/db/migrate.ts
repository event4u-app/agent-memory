import postgres from "postgres";
import { isMainModule } from "../utils/is-main-module.js";
import { logger } from "../utils/logger.js";
import { closeDb, getDb } from "./connection.js";
import { up as up001 } from "./migrations/001_initial.js";
import { up as up002 } from "./migrations/002_promotion_metadata.js";
import { up as up003 } from "./migrations/003_memory_events.js";
import { up as up004 } from "./migrations/004_memory_events_trust_extension.js";

const MIGRATIONS = [
	{ name: "001_initial", up: up001 },
	{ name: "002_promotion_metadata", up: up002 },
	{ name: "003_memory_events", up: up003 },
	{ name: "004_memory_events_trust_extension", up: up004 },
] as const;

export interface MigrationResult {
	applied: string[];
	skipped: string[];
}

export interface RunMigrationsOptions {
	/**
	 * Existing `postgres.Sql` instance. Lifecycle owned by the caller —
	 * this function will not close it. Takes precedence over `databaseUrl`.
	 */
	sql?: postgres.Sql;
	/**
	 * Custom database URL. When provided (and no `sql`), opens a dedicated
	 * connection for this run and closes it on completion. Useful for
	 * scripts and tests that do not want to pollute the shared `getDb()`
	 * connection pool.
	 */
	databaseUrl?: string;
}

/**
 * Run all pending migrations. Idempotent — already-applied migrations are
 * skipped.
 *
 * Use this from the CLI (`memory migrate`), container entrypoints
 * (auto-migrate), consumer setup scripts, or tests. Exported from the
 * package root as the stable programmatic entry point.
 */
export async function runMigrations(opts: RunMigrationsOptions = {}): Promise<MigrationResult> {
	if (opts.sql) {
		return executeMigrations(opts.sql);
	}
	if (opts.databaseUrl) {
		const sql = postgres(opts.databaseUrl, {
			max: 5,
			idle_timeout: 10,
			connect_timeout: 10,
			onnotice: () => {},
		});
		try {
			return await executeMigrations(sql);
		} finally {
			await sql.end();
		}
	}
	return executeMigrations(getDb());
}

/**
 * Read-only counterpart to `runMigrations`. Returns the names of migrations
 * that are known to this build but have not been applied to the database yet.
 *
 * Used by `memory serve`'s `/ready` endpoint (A1) and `memory migrate status`
 * — both must observe migration state without side effects.
 */
export async function listPendingMigrations(sql?: postgres.Sql): Promise<string[]> {
	const db = sql ?? getDb();
	const tableExists = await db<{ exists: boolean }[]>`
		SELECT EXISTS (
			SELECT FROM information_schema.tables
			WHERE table_name = 'memory_migrations'
		) AS "exists"
	`;
	if (!tableExists[0]?.exists) return MIGRATIONS.map((m) => m.name);
	const applied = await db<{ name: string }[]>`SELECT name FROM memory_migrations`;
	const appliedSet = new Set(applied.map((r) => r.name));
	return MIGRATIONS.filter((m) => !appliedSet.has(m.name)).map((m) => m.name);
}

export interface MigrationStatus {
	applied: string[];
	pending: string[];
	total: number;
}

/**
 * JSON-shaped migration status used by `memory migrate status` and reusable
 * from tests or /ready diagnostics. Emits every known migration in its
 * declared order with a flag whether the tracking table has seen it.
 */
export async function buildMigrationStatus(sql?: postgres.Sql): Promise<MigrationStatus> {
	const db = sql ?? getDb();
	const tableExists = await db<{ exists: boolean }[]>`
		SELECT EXISTS (
			SELECT FROM information_schema.tables
			WHERE table_name = 'memory_migrations'
		) AS "exists"
	`;
	let appliedSet = new Set<string>();
	if (tableExists[0]?.exists) {
		const rows = await db<{ name: string }[]>`SELECT name FROM memory_migrations`;
		appliedSet = new Set(rows.map((r) => r.name));
	}
	const applied: string[] = [];
	const pending: string[] = [];
	for (const m of MIGRATIONS) {
		if (appliedSet.has(m.name)) applied.push(m.name);
		else pending.push(m.name);
	}
	return { applied, pending, total: MIGRATIONS.length };
}

async function executeMigrations(db: postgres.Sql): Promise<MigrationResult> {
	const tableExists = await db`
		SELECT EXISTS (
			SELECT FROM information_schema.tables
			WHERE table_name = 'memory_migrations'
		)
	`;

	let appliedNames = new Set<string>();
	if (tableExists[0]?.exists) {
		const rows = await db`SELECT name FROM memory_migrations`;
		appliedNames = new Set(rows.map((r) => r.name as string));
	}

	const result: MigrationResult = { applied: [], skipped: [] };
	for (const m of MIGRATIONS) {
		if (appliedNames.has(m.name)) {
			result.skipped.push(m.name);
			continue;
		}
		logger.info({ migration: m.name }, "Running migration");
		await m.up(db);
		await db`INSERT INTO memory_migrations (name) VALUES (${m.name}) ON CONFLICT DO NOTHING`;
		logger.info({ migration: m.name }, "Migration applied");
		result.applied.push(m.name);
	}

	if (result.applied.length === 0) logger.info("All migrations already applied");
	return result;
}

// Direct-script invocation: `tsx src/db/migrate.ts` or `npm run db:migrate`.
// Owns the connection: open default, run, close. isMainModule resolves
// symlinks so the compiled entrypoint still triggers when called through
// a `bin` alias.
if (isMainModule(import.meta.url)) {
	runMigrations()
		.then(async () => {
			await closeDb();
			process.exit(0);
		})
		.catch(async (err) => {
			logger.error({ error: err }, "Migration failed");
			console.error("Migration failed:", err);
			await closeDb();
			process.exit(1);
		});
}
