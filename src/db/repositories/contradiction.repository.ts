import type postgres from "postgres";
import type { Contradiction } from "../../types.js";

export class ContradictionRepository {
  constructor(private readonly sql: postgres.Sql) {}

  async create(entryAId: string, entryBId: string, description: string): Promise<Contradiction> {
    const [row] = await this.sql`
      INSERT INTO memory_contradictions (entry_a_id, entry_b_id, description)
      VALUES (${entryAId}, ${entryBId}, ${description})
      RETURNING *
    `;
    return this.mapRow(row!);
  }

  async findUnresolved(): Promise<Contradiction[]> {
    const rows = await this.sql`
      SELECT * FROM memory_contradictions
      WHERE resolved_at IS NULL
      ORDER BY created_at DESC
    `;
    return rows.map((r) => this.mapRow(r));
  }

  async findByEntryId(entryId: string): Promise<Contradiction[]> {
    const rows = await this.sql`
      SELECT * FROM memory_contradictions
      WHERE entry_a_id = ${entryId} OR entry_b_id = ${entryId}
      ORDER BY created_at DESC
    `;
    return rows.map((r) => this.mapRow(r));
  }

  async resolve(id: string, resolution: string): Promise<Contradiction> {
    const [row] = await this.sql`
      UPDATE memory_contradictions
      SET resolved_at = NOW(), resolution = ${resolution}
      WHERE id = ${id}
      RETURNING *
    `;
    return this.mapRow(row!);
  }

  async countUnresolved(): Promise<number> {
    const [row] = await this.sql`
      SELECT COUNT(*)::int as count FROM memory_contradictions WHERE resolved_at IS NULL
    `;
    return row!.count;
  }

  private mapRow(row: postgres.Row): Contradiction {
    return {
      id: row.id,
      entryAId: row.entry_a_id,
      entryBId: row.entry_b_id,
      description: row.description,
      resolvedAt: row.resolved_at ? new Date(row.resolved_at) : null,
      resolution: row.resolution,
      createdAt: new Date(row.created_at),
    };
  }
}
