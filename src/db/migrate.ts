import { logger } from "../utils/logger.js";
import { closeDb, getDb } from "./connection.js";
import { up as up001 } from "./migrations/001_initial.js";
import { up as up002 } from "./migrations/002_promotion_metadata.js";

const MIGRATIONS = [
	{ name: "001_initial", up: up001 },
	{ name: "002_promotion_metadata", up: up002 },
] as const;

async function migrate() {
	const sql = getDb();

	try {
		const tableExists = await sql`
      SELECT EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_name = 'memory_migrations'
      )
    `;

		let appliedNames = new Set<string>();
		if (tableExists[0]?.exists) {
			const applied = await sql`SELECT name FROM memory_migrations`;
			appliedNames = new Set(applied.map((r) => r.name as string));
		}

		let ran = 0;
		for (const m of MIGRATIONS) {
			if (appliedNames.has(m.name)) continue;
			logger.info({ migration: m.name }, "Running migration");
			await m.up(sql);
			await sql`INSERT INTO memory_migrations (name) VALUES (${m.name}) ON CONFLICT DO NOTHING`;
			logger.info({ migration: m.name }, "Migration applied");
			ran++;
		}

		if (ran === 0) logger.info("All migrations already applied");
	} catch (error) {
		logger.error({ error }, "Migration failed");
		throw error;
	} finally {
		await closeDb();
	}
}

migrate().catch((err) => {
	console.error("Migration failed:", err);
	process.exit(1);
});
