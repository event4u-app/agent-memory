import type postgres from "postgres";
import { calculateExpiryDate } from "../../trust/scoring.js";
import { validateTransition } from "../../trust/transitions.js";
import type {
	ConsolidationTier,
	ImpactLevel,
	KnowledgeClass,
	MemoryEntry,
	MemoryScope,
	MemoryType,
	TrustInfo,
	TrustStatus,
} from "../../types.js";
import { logger } from "../../utils/logger.js";

export interface CreateEntryInput {
	type: MemoryType;
	title: string;
	summary: string;
	details?: string;
	scope: MemoryScope;
	impactLevel: ImpactLevel;
	knowledgeClass: KnowledgeClass;
	consolidationTier?: ConsolidationTier;
	embeddingText: string;
	embedding?: number[];
	createdBy?: string;
	createdInTask?: string;
}

export class MemoryEntryRepository {
	constructor(private readonly sql: postgres.Sql) {}

	async create(input: CreateEntryInput): Promise<MemoryEntry> {
		const tier = input.consolidationTier ?? "semantic";
		const expiresAt = calculateExpiryDate({
			knowledgeClass: input.knowledgeClass,
			accessCount: 0,
		});

		const [row] = await this.sql`
      INSERT INTO memory_entries (
        type, title, summary, details, scope,
        impact_level, knowledge_class, consolidation_tier,
        embedding_text, embedding,
        trust_status, trust_score, expires_at,
        created_by, created_in_task
      ) VALUES (
        ${input.type}, ${input.title}, ${input.summary}, ${input.details ?? null},
        ${JSON.stringify(input.scope)}::jsonb,
        ${input.impactLevel}, ${input.knowledgeClass}, ${tier},
        ${input.embeddingText}, ${input.embedding ? JSON.stringify(input.embedding) : null}::vector,
        'quarantine', 0.0, ${expiresAt},
        ${input.createdBy ?? "agent"}, ${input.createdInTask ?? null}
      )
      RETURNING *
    `;

		logger.debug(
			{ id: row!.id, type: input.type },
			"Memory entry created in quarantine",
		);
		return this.mapRow(row!);
	}

	async findById(id: string): Promise<MemoryEntry | null> {
		const [row] = await this.sql`
      SELECT * FROM memory_entries WHERE id = ${id}
    `;
		return row ? this.mapRow(row) : null;
	}

	async findByStatus(status: TrustStatus, limit = 50): Promise<MemoryEntry[]> {
		const rows = await this.sql`
      SELECT * FROM memory_entries
      WHERE trust_status = ${status}
      ORDER BY updated_at DESC
      LIMIT ${limit}
    `;
		return rows.map((r) => this.mapRow(r));
	}

	async findExpired(): Promise<MemoryEntry[]> {
		const rows = await this.sql`
      SELECT * FROM memory_entries
      WHERE trust_status IN ('validated', 'stale')
        AND expires_at < NOW()
      ORDER BY expires_at ASC
    `;
		return rows.map((r) => this.mapRow(r));
	}

	async transitionStatus(
		id: string,
		toStatus: TrustStatus,
		reason: string,
		triggeredBy = "system",
	): Promise<MemoryEntry> {
		const entry = await this.findById(id);
		if (!entry) throw new Error(`Entry not found: ${id}`);

		validateTransition(entry.trust.status, toStatus);

		const [row] = await this.sql`
      UPDATE memory_entries
      SET trust_status = ${toStatus},
          updated_at = NOW()
      WHERE id = ${id}
      RETURNING *
    `;

		await this.sql`
      INSERT INTO memory_status_history (memory_entry_id, from_status, to_status, reason, triggered_by)
      VALUES (${id}, ${entry.trust.status}, ${toStatus}, ${reason}, ${triggeredBy})
    `;

		logger.info(
			{ id, from: entry.trust.status, to: toStatus, reason },
			"Status transitioned",
		);
		return this.mapRow(row!);
	}

	async recordAccess(id: string): Promise<void> {
		await this.sql`
      UPDATE memory_entries
      SET access_count = access_count + 1,
          last_accessed_at = NOW()
      WHERE id = ${id}
    `;
	}

	async updateTrustScore(id: string, score: number): Promise<void> {
		await this.sql`
      UPDATE memory_entries
      SET trust_score = ${score},
          validated_at = NOW(),
          updated_at = NOW()
      WHERE id = ${id}
    `;
	}

	async updateExpiry(id: string, expiresAt: Date): Promise<void> {
		await this.sql`
      UPDATE memory_entries
      SET expires_at = ${expiresAt},
          updated_at = NOW()
      WHERE id = ${id}
    `;
	}

	async delete(id: string): Promise<boolean> {
		const result = await this.sql`
      DELETE FROM memory_entries WHERE id = ${id}
    `;
		return result.count > 0;
	}

	async count(status?: TrustStatus): Promise<number> {
		if (status) {
			const [row] = await this.sql`
        SELECT COUNT(*)::int as count FROM memory_entries WHERE trust_status = ${status}
      `;
			return row!.count;
		}
		const [row] = await this.sql`
      SELECT COUNT(*)::int as count FROM memory_entries
    `;
		return row!.count;
	}

	private mapRow(row: postgres.Row): MemoryEntry {
		return {
			id: row.id,
			type: row.type as MemoryType,
			title: row.title,
			summary: row.summary,
			details: row.details,
			scope: (typeof row.scope === "string"
				? JSON.parse(row.scope)
				: row.scope) as MemoryScope,
			impactLevel: row.impact_level as ImpactLevel,
			knowledgeClass: row.knowledge_class as KnowledgeClass,
			consolidationTier: row.consolidation_tier as ConsolidationTier,
			trust: {
				status: row.trust_status as TrustStatus,
				score: row.trust_score,
				validatedAt: row.validated_at ? new Date(row.validated_at) : null,
				expiresAt: new Date(row.expires_at),
			} satisfies TrustInfo,
			embeddingText: row.embedding_text,
			embedding: row.embedding,
			accessCount: row.access_count,
			lastAccessedAt: row.last_accessed_at
				? new Date(row.last_accessed_at)
				: null,
			createdBy: row.created_by,
			createdInTask: row.created_in_task,
			createdAt: new Date(row.created_at),
			updatedAt: new Date(row.updated_at),
		};
	}

	/**
	 * Auto-stale all validated entries whose TTL has expired.
	 * Called on retrieval to ensure expired entries are never served as validated.
	 * Returns the number of entries transitioned to 'stale'.
	 */
	async enforceExpiry(): Promise<number> {
		const result = await this.sql`
      UPDATE memory_entries
      SET trust_status = 'stale',
          updated_at = NOW()
      WHERE trust_status = 'validated'
        AND expires_at < NOW()
      RETURNING id
    `;

		if (result.length > 0) {
			// Record status changes for audit trail
			for (const row of result) {
				await this.sql`
          INSERT INTO memory_status_history (memory_entry_id, from_status, to_status, reason, triggered_by)
          VALUES (${row.id}, 'validated', 'stale', 'TTL expired (auto-stale)', 'system:expiry')
        `;
			}
			logger.info({ count: result.length }, "Auto-staled expired entries");
		}

		return result.length;
	}
}
