import type postgres from "postgres";
import type { MemoryEvidence, EvidenceKind } from "../../types.js";

export interface CreateEvidenceInput {
  memoryEntryId: string;
  kind: EvidenceKind;
  ref: string;
  details?: string;
}

export class EvidenceRepository {
  constructor(private readonly sql: postgres.Sql) {}

  async create(input: CreateEvidenceInput): Promise<MemoryEvidence> {
    const [row] = await this.sql`
      INSERT INTO memory_evidence (memory_entry_id, kind, ref, details)
      VALUES (${input.memoryEntryId}, ${input.kind}, ${input.ref}, ${input.details ?? null})
      RETURNING *
    `;
    return this.mapRow(row!);
  }

  async findByEntryId(entryId: string): Promise<MemoryEvidence[]> {
    const rows = await this.sql`
      SELECT * FROM memory_evidence
      WHERE memory_entry_id = ${entryId}
      ORDER BY created_at ASC
    `;
    return rows.map((r) => this.mapRow(r));
  }

  async countByEntryId(entryId: string): Promise<number> {
    const [row] = await this.sql`
      SELECT COUNT(*)::int as count FROM memory_evidence WHERE memory_entry_id = ${entryId}
    `;
    return row!.count;
  }

  async markVerified(id: string): Promise<void> {
    await this.sql`
      UPDATE memory_evidence SET verified_at = NOW() WHERE id = ${id}
    `;
  }

  async delete(id: string): Promise<boolean> {
    const result = await this.sql`
      DELETE FROM memory_evidence WHERE id = ${id}
    `;
    return result.count > 0;
  }

  private mapRow(row: postgres.Row): MemoryEvidence {
    return {
      id: row.id,
      memoryEntryId: row.memory_entry_id,
      kind: row.kind as EvidenceKind,
      ref: row.ref,
      details: row.details,
      verifiedAt: row.verified_at ? new Date(row.verified_at) : null,
      createdAt: new Date(row.created_at),
    };
  }
}
