// B1 · runtime-trust — turns the black-box `trust_score` into a
// per-component breakdown that mirrors `calculateTrustScore` exactly.
// Consumers: `memory explain <id>` CLI + `memory_explain` MCP tool.

import type { MemoryEvent } from "../db/repositories/memory-event.repository.js";
import type { Contradiction } from "../types.js";
import {
	type ImpactLevel,
	type KnowledgeClass,
	type MemoryEntry,
	MIN_EVIDENCE_COUNT,
	TRUST_SCORE_CAP_SINGLE_EVIDENCE,
	TTL_DAYS,
} from "../types.js";

export interface ExplainInputs {
	entry: MemoryEntry;
	evidenceCount: number;
	events: MemoryEvent[];
	contradictions: Contradiction[];
	now?: Date;
}

export interface ScoreComponents {
	evidence: {
		count: number;
		min_required: number;
		contribution: number;
		note: string;
	};
	access_boost: {
		access_count: number;
		contribution: number;
		max: number;
		note: string;
	};
	decay: {
		days_since_validation: number;
		ttl_days: number;
		penalty: number;
		note: string;
	};
	single_evidence_cap: { applied: boolean; cap: number | null };
}

export interface ExplainV1 {
	contract_version: "explain-v1";
	entry: {
		id: string;
		title: string;
		type: string;
		status: string;
		impact_level: ImpactLevel;
		knowledge_class: KnowledgeClass;
		stored_score: number;
		access_count: number;
		expires_at: string;
	};
	score: {
		computed: number;
		components: ScoreComponents;
		why_not_max: string[];
	};
	promotion_history: Array<{
		event_type: string;
		occurred_at: string;
		actor: string;
		reason: string | null;
		before: Record<string, unknown> | null;
		after: Record<string, unknown> | null;
	}>;
	contradictions: Array<{ id: string; description: string; resolved: boolean }>;
	decay: { expires_at: string; days_until_expiry: number; stale_at_current_rate: boolean };
}

function daysBetween(a: Date, b: Date): number {
	const ms = a.getTime() - b.getTime();
	return ms / (1000 * 60 * 60 * 24);
}

export function explainEntry(inputs: ExplainInputs): ExplainV1 {
	const { entry, evidenceCount, events, contradictions, now = new Date() } = inputs;

	// Recompute the score in-place so the breakdown matches the published
	// formula (`calculateTrustScore`) — not the historical stored value.
	// If the two drift, operators see it in the response.
	const minEvidence = MIN_EVIDENCE_COUNT[entry.impactLevel];
	let base: number;
	let evidenceNote: string;
	if (evidenceCount === 0) {
		base = 0.2;
		evidenceNote = "no evidence — floor 0.2";
	} else if (evidenceCount < minEvidence) {
		base = 0.4 + (evidenceCount / minEvidence) * 0.2;
		evidenceNote = `under floor: ${evidenceCount}/${minEvidence} evidence — scales 0.4→0.6`;
	} else {
		base = 0.7 + Math.min(evidenceCount - minEvidence, 3) * 0.1;
		evidenceNote = `floor cleared: base 0.7 +0.1 per surplus evidence (cap +0.3)`;
	}
	const capApplied = evidenceCount === 1;
	const cap = capApplied ? TRUST_SCORE_CAP_SINGLE_EVIDENCE[entry.impactLevel] : null;
	if (capApplied && cap !== null) base = Math.min(base, cap);

	const accessBoost = Math.min(entry.accessCount / 50, 0.1);
	const ttlDays = TTL_DAYS[entry.knowledgeClass];
	const daysSince = entry.trust.validatedAt ? daysBetween(now, entry.trust.validatedAt) : 0;
	let decayPenalty = 0;
	let decayNote = "no decay — within first half of TTL";
	if (daysSince > ttlDays * 0.5) {
		const factor = Math.min((daysSince - ttlDays * 0.5) / (ttlDays * 0.5), 1);
		decayPenalty = factor * 0.3;
		decayNote = `past half-life: -${decayPenalty.toFixed(2)} (half-life ${ttlDays / 2}d, age ${daysSince.toFixed(1)}d)`;
	}
	const computed = Math.max(0, Math.min(1, base + accessBoost - decayPenalty));

	const whyNotMax: string[] = [];
	if (base < 0.9) whyNotMax.push(`evidence base ${base.toFixed(2)} < 0.9 — ${evidenceNote}`);
	if (accessBoost < 0.1)
		whyNotMax.push(
			`access_boost +${accessBoost.toFixed(2)} (max +0.10) — needs 50 accesses, have ${entry.accessCount}`,
		);
	if (decayPenalty > 0) whyNotMax.push(decayNote);
	if (capApplied && cap !== null)
		whyNotMax.push(`single-evidence cap: ${cap} for impact=${entry.impactLevel}`);

	// Promotion history = every trust_event on this entry, ascending.
	const history = [...events]
		.sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime())
		.map((e) => ({
			event_type: e.eventType,
			occurred_at: e.occurredAt.toISOString(),
			actor: e.actor,
			reason: e.reason,
			before: e.before,
			after: e.after,
		}));

	const daysUntil = daysBetween(entry.trust.expiresAt, now);
	return {
		contract_version: "explain-v1",
		entry: {
			id: entry.id,
			title: entry.title,
			type: entry.type,
			status: entry.trust.status,
			impact_level: entry.impactLevel,
			knowledge_class: entry.knowledgeClass,
			stored_score: entry.trust.score,
			access_count: entry.accessCount,
			expires_at: entry.trust.expiresAt.toISOString(),
		},
		score: {
			computed: Number(computed.toFixed(4)),
			components: {
				evidence: {
					count: evidenceCount,
					min_required: minEvidence,
					contribution: Number(base.toFixed(4)),
					note: evidenceNote,
				},
				access_boost: {
					access_count: entry.accessCount,
					contribution: Number(accessBoost.toFixed(4)),
					max: 0.1,
					note: `+${accessBoost.toFixed(2)} from ${entry.accessCount} access(es)`,
				},
				decay: {
					days_since_validation: Number(daysSince.toFixed(2)),
					ttl_days: ttlDays,
					penalty: Number(decayPenalty.toFixed(4)),
					note: decayNote,
				},
				single_evidence_cap: { applied: capApplied, cap },
			},
			why_not_max: whyNotMax,
		},
		promotion_history: history,
		contradictions: contradictions.map((c) => ({
			id: c.id,
			description: c.description,
			resolved: c.resolvedAt !== null,
		})),
		decay: {
			expires_at: entry.trust.expiresAt.toISOString(),
			days_until_expiry: Number(daysUntil.toFixed(2)),
			stale_at_current_rate: daysUntil <= 0,
		},
	};
}
