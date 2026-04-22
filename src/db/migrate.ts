import { fileURLToPath } from "node:url";
import type postgres from "postgres";
import { logger } from "../utils/logger.js";
import { closeDb, getDb } from "./connection.js";
import { up as up001 } from "./migrations/001_initial.js";
import { up as up002 } from "./migrations/002_promotion_metadata.js";

const MIGRATIONS = [
	{ name: "001_initial", up: up001 },
	{ name: "002_promotion_metadata", up: up002 },
] as const;

export interface MigrationResult {
	applied: string[];
	skipped: string[];
}

/**
 * Run all pending migrations.
 *
 * Caller owns the connection lifecycle — this function does NOT close the
 * passed / shared `sql` instance. Use this from the CLI (`memory migrate`),
 * container entrypoints (auto-migrate), or tests.
 */
export async function runMigrations(sql?: postgres.Sql): Promise<MigrationResult> {
	const db = sql ?? getDb();

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
// Owns the connection: open default, run, close.
if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) {
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
