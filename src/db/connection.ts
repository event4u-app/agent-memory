import postgres from "postgres";
import { config } from "../config.js";
import { logger } from "../utils/logger.js";

let sql: postgres.Sql | null = null;

export function getDb(testMode = false): postgres.Sql {
  if (sql) return sql;

  const url = testMode ? config.database.urlTest : config.database.url;

  sql = postgres(url, {
    max: 10,
    idle_timeout: 20,
    connect_timeout: 10,
    onnotice: () => {},
  });

  logger.info({ url: url.replace(/\/\/.*@/, "//***@") }, "Database connected");

  return sql;
}

export async function closeDb(): Promise<void> {
  if (sql) {
    await sql.end();
    sql = null;
    logger.info("Database connection closed");
  }
}

export async function healthCheck(): Promise<{ ok: boolean; latencyMs: number }> {
  const start = Date.now();
  try {
    const db = getDb();
    await db`SELECT 1`;
    return { ok: true, latencyMs: Date.now() - start };
  } catch {
    return { ok: false, latencyMs: Date.now() - start };
  }
}
