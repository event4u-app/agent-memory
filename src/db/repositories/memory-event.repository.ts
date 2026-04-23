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

// Held separately from SECRET_EVENT_TYPES so B4 can add trust-transition
// types later without widening the secret-event allow-list.
export type MemoryEventType = SecretEventType;

export interface MemoryEvent {
	id: string;
	entryId: string | null;
	occurredAt: Date;
	actor: string;
	eventType: MemoryEventType;
	metadata: Record<string, unknown>;
}

export interface RecordEventInput {
	entryId?: string | null;
	actor: string;
	eventType: MemoryEventType;
	metadata?: Record<string, unknown>;
}

export interface EventTypeCount {
	eventType: MemoryEventType;
	count: number;
}

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
		const [row] = await this.sql`
      INSERT INTO memory_events (entry_id, actor, event_type, metadata)
      VALUES (
        ${input.entryId ?? null},
        ${input.actor},
        ${input.eventType},
        ${JSON.stringify(input.metadata ?? {})}::jsonb
      )
      RETURNING id, entry_id, occurred_at, actor, event_type, metadata
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

	async listByEntry(entryId: string, limit = 100): Promise<MemoryEvent[]> {
		const rows = await this.sql`
      SELECT id, entry_id, occurred_at, actor, event_type, metadata
      FROM memory_events
      WHERE entry_id = ${entryId}
      ORDER BY occurred_at DESC
      LIMIT ${limit}
    `;
		return rows.map((r) => this.mapRow(r));
	}

	private mapRow(row: postgres.Row): MemoryEvent {
		return {
			id: row.id as string,
			entryId: (row.entry_id as string | null) ?? null,
			occurredAt: row.occurred_at as Date,
			actor: row.actor as string,
			eventType: row.event_type as MemoryEventType,
			metadata: (row.metadata as Record<string, unknown>) ?? {},
		};
	}
}
