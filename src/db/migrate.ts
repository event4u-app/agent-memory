import { getDb, closeDb } from "./connection.js";
import { up } from "./migrations/001_initial.js";
import { logger } from "../utils/logger.js";

async function migrate() {
  const sql = getDb();

  try {
    // Check if migrations table exists
    const tableExists = await sql`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_name = 'memory_migrations'
      )
    `;

    if (tableExists[0]?.exists) {
      const applied = await sql`SELECT name FROM memory_migrations`;
      const appliedNames = new Set(applied.map((r) => r.name));

      if (appliedNames.has("001_initial")) {
        logger.info("All migrations already applied");
        return;
      }
    }

    logger.info("Running migration: 001_initial");
    await up(sql);
    await sql`INSERT INTO memory_migrations (name) VALUES ('001_initial') ON CONFLICT DO NOTHING`;
    logger.info("Migration 001_initial applied successfully");
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
