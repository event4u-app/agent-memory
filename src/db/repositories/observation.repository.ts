import crypto from "node:crypto";
import type postgres from "postgres";
import type { Observation } from "../../types.js";
import { logger } from "../../utils/logger.js";

const DEDUP_WINDOW_MINUTES = 5;

export class ObservationRepository {
	constructor(private readonly sql: postgres.Sql) {}

	async create(sessionId: string, content: string, source = "tool"): Promise<Observation | null> {
		const hash = crypto.createHash("sha256").update(content).digest("hex");

		// Dedup: check if same hash exists within time window
		const [existing] = await this.sql`
      SELECT id FROM memory_observations
      WHERE hash = ${hash}
        AND created_at > NOW() - INTERVAL '${this.sql(String(DEDUP_WINDOW_MINUTES))} minutes'
    `;

		if (existing) {
			logger.debug({ hash: hash.slice(0, 8) }, "Observation deduped (same content within 5min)");
			return null;
		}

		const [row] = await this.sql`
      INSERT INTO memory_observations (session_id, hash, content, source)
      VALUES (${sessionId}, ${hash}, ${content}, ${source})
      RETURNING *
    `;

		return this.mapRow(row!);
	}

	async findBySession(sessionId: string): Promise<Observation[]> {
		const rows = await this.sql`
      SELECT * FROM memory_observations
      WHERE session_id = ${sessionId}
      ORDER BY created_at ASC
    `;
		return rows.map((r) => this.mapRow(r));
	}

	async countBySession(sessionId: string): Promise<number> {
		const [row] = await this.sql`
      SELECT COUNT(*)::int as count FROM memory_observations WHERE session_id = ${sessionId}
    `;
		return row?.count;
	}

	async deleteOlderThan(days: number): Promise<number> {
		const result = await this.sql`
      DELETE FROM memory_observations
      WHERE created_at < NOW() - INTERVAL '${this.sql(String(days))} days'
    `;
		return result.count;
	}

	private mapRow(row: postgres.Row): Observation {
		return {
			id: row.id,
			sessionId: row.session_id,
			hash: row.hash,
			content: row.content,
			source: row.source,
			createdAt: new Date(row.created_at),
		};
	}
}
