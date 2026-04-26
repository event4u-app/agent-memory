import type postgres from "postgres";
import { recordTrustTransition } from "../../observability/metrics.js";
import { calculateExpiryDate } from "../../trust/scoring.js";
import { validateTransition } from "../../trust/transitions.js";
import type {
	ConsolidationTier,
	ImpactLevel,
	KnowledgeClass,
	MemoryEntry,
	MemoryScope,
	MemoryType,
	PromotionMetadata,
	TrustInfo,
	TrustStatus,
} from "../../types.js";
import { logger } from "../../utils/logger.js";
import type { MemoryEventRepository, TrustEventType } from "./memory-event.repository.js";

/**
 * Map a status transition (from,to) to a trust-audit event type (B4).
 * Returns null for same-status no-ops. Poison / archive / invalidate
 * are handled by their dedicated services where richer metadata is
 * available — this mapping covers the lifecycle transitions flowing
 * through `transitionStatus()`.
 */
function statusTransitionToEventType(from: TrustStatus, to: TrustStatus): TrustEventType | null {
	if (from === to) return null;
	if (to === "validated") return from === "stale" ? "entry_revived" : "entry_promoted";
	if (to === "stale") return "entry_stale";
	if (to === "invalidated") return "entry_invalidated";
	if (to === "rejected") return "entry_deprecated";
	if (to === "poisoned") return "entry_quarantined";
	if (to === "archived") return "entry_archived";
	return null;
}

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
	promotionMetadata?: PromotionMetadata;
}

export class MemoryEntryRepository {
	/**
	 * Optional audit-event recorder for B4 trust-audit emissions. Held
	 * as a mutable field so wiring can attach it late (MCP context,
	 * CLI factory) without breaking the dozens of `new MemoryEntryRepository(sql)`
	 * call sites in tests and short-lived CLI handlers.
	 */
	private eventRepo: MemoryEventRepository | undefined;

	constructor(
		private readonly sql: postgres.Sql,
		eventRepo?: MemoryEventRepository,
	) {
		this.eventRepo = eventRepo;
	}

	/**
	 * Late-bind the audit recorder. Used by context factories that
	 * instantiate repos before the event repo is ready (rare — normally
	 * pass via constructor).
	 */
	setEventRepository(repo: MemoryEventRepository): void {
		this.eventRepo = repo;
	}

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
        created_by, created_in_task, promotion_metadata
      ) VALUES (
        ${input.type}, ${input.title}, ${input.summary}, ${input.details ?? null},
        ${this.sql.json(input.scope as unknown as postgres.JSONValue)},
        ${input.impactLevel}, ${input.knowledgeClass}, ${tier},
        ${input.embeddingText}, ${input.embedding ? JSON.stringify(input.embedding) : null}::vector,
        'quarantine', 0.0, ${expiresAt},
        ${input.createdBy ?? "agent"}, ${input.createdInTask ?? null},
        ${this.sql.json((input.promotionMetadata ?? {}) as unknown as postgres.JSONValue)}
      )
      RETURNING *
    `;

		logger.debug({ id: row?.id, type: input.type }, "Memory entry created in quarantine");
		const entry = this.mapRow(row!);
		await this.emitEvent({
			entryId: entry.id,
			eventType: "entry_proposed",
			actor: input.createdBy ?? "agent",
			after: {
				status: entry.trust.status,
				score: entry.trust.score,
				type: entry.type,
				tier: entry.consolidationTier,
			},
			reason: `Proposed as ${entry.type} (${input.impactLevel}/${input.knowledgeClass})`,
		});
		return entry;
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

		recordTrustTransition(entry.trust.status, toStatus);
		logger.info({ id, from: entry.trust.status, to: toStatus, reason }, "Status transitioned");

		// B4 audit emission — memory_status_history remains as the cheap per-transition
		// row, memory_events carries the structured before/after/reason that
		// `memory explain` / `memory history` read. Same writer on purpose so the two
		// tables cannot drift.
		const eventType = statusTransitionToEventType(entry.trust.status, toStatus);
		if (eventType) {
			await this.emitEvent({
				entryId: id,
				eventType,
				actor: triggeredBy,
				before: { status: entry.trust.status, score: entry.trust.score },
				after: { status: toStatus, score: entry.trust.score },
				reason,
			});
		}

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

	async updatePromotionMetadata(id: string, metadata: PromotionMetadata): Promise<void> {
		await this.sql`
      UPDATE memory_entries
      SET promotion_metadata = ${this.sql.json(metadata as unknown as postgres.JSONValue)},
          updated_at = NOW()
      WHERE id = ${id}
    `;
	}

	/**
	 * Find an already-promoted entry that describes the same knowledge as `candidate`.
	 * Match: same type + same repository + at least one overlapping file OR symbol,
	 * with trust_status = 'validated' and tier in ('semantic', 'procedural').
	 * Returns the first such entry (by trust_score desc), or null.
	 */
	async findSemanticDuplicate(candidate: MemoryEntry): Promise<MemoryEntry | null> {
		const files = candidate.scope.files ?? [];
		const symbols = candidate.scope.symbols ?? [];
		if (files.length === 0 && symbols.length === 0) return null;

		const [row] = await this.sql`
      SELECT * FROM memory_entries
      WHERE id <> ${candidate.id}
        AND type = ${candidate.type}
        AND trust_status = 'validated'
        AND consolidation_tier IN ('semantic', 'procedural')
        AND scope->>'repository' = ${candidate.scope.repository}
        AND (
          (${this.sql.json(files)} <> '[]'::jsonb
            AND scope->'files' ?| ARRAY(SELECT jsonb_array_elements_text(${this.sql.json(files)})))
          OR
          (${this.sql.json(symbols)} <> '[]'::jsonb
            AND scope->'symbols' ?| ARRAY(SELECT jsonb_array_elements_text(${this.sql.json(symbols)})))
        )
      ORDER BY trust_score DESC, updated_at DESC
      LIMIT 1
    `;
		return row ? this.mapRow(row) : null;
	}

	async delete(id: string): Promise<boolean> {
		const result = await this.sql`
      DELETE FROM memory_entries WHERE id = ${id}
    `;
		return result.count > 0;
	}

	/**
	 * Stream every entry regardless of status in stable, batch-sized pages.
	 * Uses keyset pagination on `id` (UUID v4, monotonic enough for a read-
	 * only sweep) so callers iterating large tables do not load the whole
	 * set into memory. Used by `memory audit secrets` (III1).
	 */
	async *iterateAll(batchSize = 500): AsyncGenerator<MemoryEntry[]> {
		let cursor: string | null = null;
		while (true) {
			const rows: postgres.Row[] = cursor
				? await this.sql`
					SELECT * FROM memory_entries
					WHERE id > ${cursor}
					ORDER BY id ASC
					LIMIT ${batchSize}
				`
				: await this.sql`
					SELECT * FROM memory_entries
					ORDER BY id ASC
					LIMIT ${batchSize}
				`;
			if (rows.length === 0) return;
			yield rows.map((r) => this.mapRow(r));
			if (rows.length < batchSize) return;
			cursor = rows[rows.length - 1]!.id as string;
		}
	}

	/**
	 * Atomically rewrite redacted content fields for a single entry. Used by
	 * `memory audit secrets --fix --mode=redact` after the audit core has
	 * computed the patch and the caller has re-embedded `embeddingText`
	 * via the I3 boundary. Undefined values stay untouched.
	 */
	async updateRedactedFields(
		id: string,
		patch: {
			title?: string;
			summary?: string;
			details?: string;
			embeddingText?: string;
			embedding?: number[];
		},
	): Promise<void> {
		await this.sql`
			UPDATE memory_entries
			SET
				title          = COALESCE(${patch.title ?? null}, title),
				summary        = COALESCE(${patch.summary ?? null}, summary),
				details        = COALESCE(${patch.details ?? null}, details),
				embedding_text = COALESCE(${patch.embeddingText ?? null}, embedding_text),
				embedding      = COALESCE(
					${patch.embedding ? JSON.stringify(patch.embedding) : null}::vector,
					embedding
				),
				updated_at     = NOW()
			WHERE id = ${id}
		`;
	}

	async count(status?: TrustStatus): Promise<number> {
		if (status) {
			const [row] = await this.sql`
        SELECT COUNT(*)::int as count FROM memory_entries WHERE trust_status = ${status}
      `;
			return row?.count;
		}
		const [row] = await this.sql`
      SELECT COUNT(*)::int as count FROM memory_entries
    `;
		return row?.count;
	}

	private mapRow(row: postgres.Row): MemoryEntry {
		return {
			id: row.id,
			type: row.type as MemoryType,
			title: row.title,
			summary: row.summary,
			details: row.details,
			scope: (typeof row.scope === "string" ? JSON.parse(row.scope) : row.scope) as MemoryScope,
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
			lastAccessedAt: row.last_accessed_at ? new Date(row.last_accessed_at) : null,
			createdBy: row.created_by,
			createdInTask: row.created_in_task,
			createdAt: new Date(row.created_at),
			updatedAt: new Date(row.updated_at),
			promotionMetadata: (typeof row.promotion_metadata === "string"
				? JSON.parse(row.promotion_metadata)
				: (row.promotion_metadata ?? {})) as PromotionMetadata,
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
				await this.emitEvent({
					entryId: row.id as string,
					eventType: "entry_stale",
					actor: "system:expiry",
					before: { status: "validated" },
					after: { status: "stale" },
					reason: "TTL expired (auto-stale)",
				});
			}
			logger.info({ count: result.length }, "Auto-staled expired entries");
		}

		return result.length;
	}

	/**
	 * Fire-and-forget event emission. Swallows recorder errors so audit
	 * failures never break a legitimate entry write — we prefer a missing
	 * event row over a dropped status transition. The logger line here is
	 * the canary operators watch in production.
	 */
	private async emitEvent(input: {
		entryId: string;
		eventType: TrustEventType;
		actor: string;
		before?: Record<string, unknown> | null;
		after?: Record<string, unknown> | null;
		reason?: string | null;
	}): Promise<void> {
		if (!this.eventRepo) return;
		try {
			await this.eventRepo.record(input);
		} catch (err) {
			logger.warn(
				{ err, entryId: input.entryId, eventType: input.eventType },
				"Failed to record trust-audit event (continuing)",
			);
		}
	}
}
