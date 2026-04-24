import type postgres from "postgres";

/**
 * Secret-safety event types (roadmap IV1). The string union is the
 * application-layer enforcement of `event_type` values — the migration
 * stores raw text so later roadmaps (runtime-trust B4 trust-transition
 * events, invalidation events, poison cascades) can extend this union
 * without a DDL change.
 *
 * Never record the secret itself or a hash of it — hashes enable
 * brute-force lookup. The metadata bag carries pattern name + ingress
 * path only; `src/db/migrations/003_memory_events.ts` spells out the
 * full contract.
 */
export const SECRET_EVENT_TYPES = [
	"secret_rejected",
	"secret_redacted",
	"secret_detected_on_retrieve",
	"secret_detected_on_legacy_scan",
] as const;
export type SecretEventType = (typeof SECRET_EVENT_TYPES)[number];

/**
 * Trust-transition event types (B4 · runtime-trust). Every transition
 * that changes an entry's trust lifecycle lands as one of these so
 * `memory explain` (B1) + `memory history` (B2) can reconstruct the
 * path without loading a series of entry snapshots.
 */
export const TRUST_EVENT_TYPES = [
	"entry_proposed", // new quarantined entry created
	"entry_promoted", // quarantined → validated (gate passed)
	"entry_quarantined", // any → quarantined (poison cascade / manual)
	"entry_stale", // validated → stale (TTL / decay)
	"entry_revived", // stale → validated (revalidation job)
	"entry_deprecated", // any → deprecated (manual or superseded_by set)
	"entry_superseded", // paired with entry_deprecated when a new entry replaces it
	"entry_invalidated", // diff / drift / file-delete invalidation
	"entry_archived", // stale/invalidated → archived (retention)
] as const;
export type TrustEventType = (typeof TRUST_EVENT_TYPES)[number];

// Union grows additively — secret allow-list stays narrow; trust union
// holds everything the runtime-trust audit log emits.
export type MemoryEventType = SecretEventType | TrustEventType;

export interface MemoryEvent {
	id: string;
	entryId: string | null;
	occurredAt: Date;
	actor: string;
	eventType: MemoryEventType;
	metadata: Record<string, unknown>;
	/** B4: structured before-state snapshot. Null for secret events. */
	before: Record<string, unknown> | null;
	/** B4: structured after-state snapshot. Null for secret events. */
	after: Record<string, unknown> | null;
	/** B4: free-form reason string (capped 512 chars at write time). */
	reason: string | null;
}

export interface RecordEventInput {
	entryId?: string | null;
	actor: string;
	eventType: MemoryEventType;
	metadata?: Record<string, unknown>;
	before?: Record<string, unknown> | null;
	after?: Record<string, unknown> | null;
	reason?: string | null;
}

export interface EventTypeCount {
	eventType: MemoryEventType;
	count: number;
}

const REASON_MAX_LEN = 512;

/**
 * Append-only repository for `memory_events`. No `update()` / `delete()`
 * by design: an audit log that can rewrite its own history is not an
 * audit log.
 */
export class MemoryEventRepository {
	constructor(private readonly sql: postgres.Sql) {}

	async record(input: RecordEventInput): Promise<MemoryEvent> {
		// JSON.stringify + ::jsonb matches the project convention used by
		// MemoryEntryRepository for promotion_metadata — keeps serialization
		// explicit and side-steps postgres.js' JSONValue typing on this.sql.json().
		const reason = input.reason
			? input.reason.length > REASON_MAX_LEN
				? input.reason.slice(0, REASON_MAX_LEN)
				: input.reason
			: null;
		const [row] = await this.sql`
      INSERT INTO memory_events (entry_id, actor, event_type, metadata, before, after, reason)
      VALUES (
        ${input.entryId ?? null},
        ${input.actor},
        ${input.eventType},
        ${JSON.stringify(input.metadata ?? {})}::jsonb,
        ${input.before ? JSON.stringify(input.before) : null}::jsonb,
        ${input.after ? JSON.stringify(input.after) : null}::jsonb,
        ${reason}
      )
      RETURNING id, entry_id, occurred_at, actor, event_type, metadata, before, after, reason
    `;
		return this.mapRow(row!);
	}

	/**
	 * Count events per type within a recent window. Used by
	 * `memory diagnose` (IV1 Done criterion) and `memory doctor` (IV2).
	 * `sinceMinutes = 1440` → last 24 h; `sinceMinutes = 10080` → 7 d.
	 *
	 * When `types` is provided, the result is filtered to those types.
	 * Missing types are emitted with count = 0 so consumers can render
	 * a stable table.
	 */
	async countByTypeSince(
		sinceMinutes: number,
		types?: readonly MemoryEventType[],
	): Promise<EventTypeCount[]> {
		const rows = types
			? await this.sql<{ event_type: MemoryEventType; count: number }[]>`
          SELECT event_type, COUNT(*)::int AS count
          FROM memory_events
          WHERE occurred_at > NOW() - (${sinceMinutes} || ' minutes')::interval
            AND event_type = ANY(${[...types]})
          GROUP BY event_type
        `
			: await this.sql<{ event_type: MemoryEventType; count: number }[]>`
          SELECT event_type, COUNT(*)::int AS count
          FROM memory_events
          WHERE occurred_at > NOW() - (${sinceMinutes} || ' minutes')::interval
          GROUP BY event_type
        `;
		const found = new Map(rows.map((r) => [r.event_type, r.count]));
		const expected = types ?? [...SECRET_EVENT_TYPES];
		return expected.map((t) => ({ eventType: t, count: found.get(t) ?? 0 }));
	}

	async listByEntry(
		entryId: string,
		limitOrOptions: number | { limit?: number; since?: Date } = 100,
	): Promise<MemoryEvent[]> {
		// Legacy callers pass a bare number; B2 callers pass an options
		// bag so the `since` cursor ships without a second overload.
		const { limit = 100, since } =
			typeof limitOrOptions === "number" ? { limit: limitOrOptions } : limitOrOptions;
		const rows = since
			? await this.sql`
      SELECT id, entry_id, occurred_at, actor, event_type, metadata, before, after, reason
      FROM memory_events
      WHERE entry_id = ${entryId} AND occurred_at >= ${since}
      ORDER BY occurred_at DESC
      LIMIT ${limit}
    `
			: await this.sql`
      SELECT id, entry_id, occurred_at, actor, event_type, metadata, before, after, reason
      FROM memory_events
      WHERE entry_id = ${entryId}
      ORDER BY occurred_at DESC
      LIMIT ${limit}
    `;
		return rows.map((r) => this.mapRow(r));
	}

	/**
	 * Count events recorded against a single entry, bucketed by type.
	 * Used by `memory diagnose` (B4) so operators can spot entries with
	 * churn — many re-invalidations, many stale/revive cycles — without
	 * pulling the full history.
	 */
	async countByEntry(entryId: string): Promise<EventTypeCount[]> {
		const rows = await this.sql<{ event_type: MemoryEventType; count: number }[]>`
      SELECT event_type, COUNT(*)::int AS count
      FROM memory_events
      WHERE entry_id = ${entryId}
      GROUP BY event_type
      ORDER BY count DESC
    `;
		return rows.map((r) => ({ eventType: r.event_type, count: r.count }));
	}

	private mapRow(row: postgres.Row): MemoryEvent {
		return {
			id: row.id as string,
			entryId: (row.entry_id as string | null) ?? null,
			occurredAt: row.occurred_at as Date,
			actor: row.actor as string,
			eventType: row.event_type as MemoryEventType,
			metadata: (row.metadata as Record<string, unknown>) ?? {},
			before: (row.before as Record<string, unknown> | null) ?? null,
			after: (row.after as Record<string, unknown> | null) ?? null,
			reason: (row.reason as string | null) ?? null,
		};
	}
}
