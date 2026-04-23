import postgres from "postgres";
import { isMainModule } from "../utils/is-main-module.js";
import { logger } from "../utils/logger.js";
import { closeDb, getDb } from "./connection.js";
import { up as up001 } from "./migrations/001_initial.js";
import { up as up002 } from "./migrations/002_promotion_metadata.js";
import { up as up003 } from "./migrations/003_memory_events.js";

const MIGRATIONS = [
	{ name: "001_initial", up: up001 },
	{ name: "002_promotion_metadata", up: up002 },
	{ name: "003_memory_events", up: up003 },
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
