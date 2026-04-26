// B2 · runtime-trust — turns `memory_events` into a forensic timeline.
// Consumers: `memory history <id>` CLI + `memory_history` MCP tool.
//
// Unlike `explain` (B1, current state), `history` reconstructs how the
// trust lifecycle got here: each event lands in a day-bucket with the
// actor-kind decoded and a minimal before/after diff on the fields
// that actually change trust (status, score).

import type { MemoryEvent } from "../db/repositories/memory-event.repository.js";
import type { MemoryEntry } from "../types.js";

export type ActorKind = "user" | "agent" | "system" | "unknown";

export interface HistoryInputs {
	entry: MemoryEntry;
	events: MemoryEvent[];
	since?: Date | null;
	now?: Date;
}

export interface HistoryDiff {
	status?: { before: string | null; after: string | null };
	score?: { before: number | null; after: number | null };
}

export interface HistoryEvent {
	id: string;
	occurred_at: string;
	actor: string;
	actor_kind: ActorKind;
	event_type: string;
	reason: string | null;
	diff: HistoryDiff;
}

export interface HistoryDay {
	day: string; // YYYY-MM-DD, UTC
	events: HistoryEvent[];
}

export interface HistoryV1 {
	contract_version: "history-v1";
	entry: {
		id: string;
		title: string;
		type: string;
		status: string;
		current_score: number;
	};
	range: {
		since: string | null;
		until: string;
		event_count: number;
	};
	timeline: HistoryDay[];
}

// Actor convention: `user:*`, `agent:*`, `system:*`. Anything else is
// unknown so operators can spot rogue emitters without silent dropping.
export function classifyActor(actor: string): ActorKind {
	if (actor.startsWith("user:")) return "user";
	if (actor.startsWith("agent:")) return "agent";
	if (actor.startsWith("system:")) return "system";
	return "unknown";
}

function pickString(bag: Record<string, unknown> | null, key: string): string | null {
	if (!bag) return null;
	const v = bag[key];
	return typeof v === "string" ? v : null;
}

function pickNumber(bag: Record<string, unknown> | null, key: string): number | null {
	if (!bag) return null;
	const v = bag[key];
	return typeof v === "number" ? v : null;
}

function buildDiff(event: MemoryEvent): HistoryDiff {
	const diff: HistoryDiff = {};
	const beforeStatus = pickString(event.before, "status");
	const afterStatus = pickString(event.after, "status");
	if (beforeStatus !== null || afterStatus !== null) {
		diff.status = { before: beforeStatus, after: afterStatus };
	}
	const beforeScore = pickNumber(event.before, "score");
	const afterScore = pickNumber(event.after, "score");
	if (beforeScore !== null || afterScore !== null) {
		diff.score = { before: beforeScore, after: afterScore };
	}
	return diff;
}

function utcDayKey(d: Date): string {
	// YYYY-MM-DD in UTC; insulates the bucket from caller-timezone drift
	// so the same event lands in the same day regardless of the host.
	return d.toISOString().slice(0, 10);
}

export function buildHistory(inputs: HistoryInputs): HistoryV1 {
	const { entry, events, since = null, now = new Date() } = inputs;

	// Sort ascending so the timeline reads chronologically; the repo
	// returns DESC because B1 wants newest-first. Copy before sorting so
	// the caller's array stays untouched.
	const sorted = [...events].sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());

	const buckets = new Map<string, HistoryEvent[]>();
	for (const e of sorted) {
		const key = utcDayKey(e.occurredAt);
		const entry: HistoryEvent = {
			id: e.id,
			occurred_at: e.occurredAt.toISOString(),
			actor: e.actor,
			actor_kind: classifyActor(e.actor),
			event_type: e.eventType,
			reason: e.reason,
			diff: buildDiff(e),
		};
		const bucket = buckets.get(key);
		if (bucket) bucket.push(entry);
		else buckets.set(key, [entry]);
	}

	const timeline: HistoryDay[] = [...buckets.entries()]
		.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
		.map(([day, events]) => ({ day, events }));

	return {
		contract_version: "history-v1",
		entry: {
			id: entry.id,
			title: entry.title,
			type: entry.type,
			status: entry.trust.status,
			current_score: entry.trust.score,
		},
		range: {
			since: since ? since.toISOString() : null,
			until: now.toISOString(),
			event_count: sorted.length,
		},
		timeline,
	};
}
