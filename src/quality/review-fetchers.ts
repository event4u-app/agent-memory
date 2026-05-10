// B3 · runtime-trust — database fetchers for `buildReviewDigest`.
// Extracted from the CLI/MCP handlers so both pull identical rows
// through the same SQL; review.service.ts stays pure.

import type postgres from "postgres";
import type { ImpactLevel } from "../types.js";

const STALE_HIGH_VALUE_MIN_IMPACT: ImpactLevel[] = ["high", "critical"];
const POISON_TRUST_MAX = 0.4;
const POISON_MIN_INVALIDATIONS = 2;
const POISON_WINDOW_DAYS = 30;

export interface StaleHighValueRow {
	id: string;
	title: string;
	impactLevel: ImpactLevel;
	trustScore: number;
	daysSinceValidation: number;
}

export interface PoisonCandidateRow {
	entryId: string;
	title: string;
	trustScore: number;
	invalidationCount: number;
}

/**
 * Stale entries on high/critical-impact knowledge. These are the ones
 * a team actually needs to look at — a stale "how does auth work" is a
 * liability, a stale "what colour is our OK button" is noise.
 */
export async function fetchStaleHighValue(
	sql: postgres.Sql,
	limit: number,
): Promise<StaleHighValueRow[]> {
	const rows = await sql<
		{ id: string; title: string; impact_level: ImpactLevel; trust_score: number; days: number }[]
	>`
    SELECT
      id,
      title,
      impact_level,
      trust_score,
      EXTRACT(EPOCH FROM (NOW() - last_validated_at)) / 86400.0 AS days
    FROM memory_entries
    WHERE trust_status = 'stale'
      AND impact_level = ANY(${STALE_HIGH_VALUE_MIN_IMPACT})
      AND last_validated_at IS NOT NULL
    ORDER BY impact_level DESC, last_validated_at ASC
    LIMIT ${limit}
  `;
	return rows.map((r) => ({
		id: r.id,
		title: r.title,
		impactLevel: r.impact_level,
		trustScore: Number(r.trust_score),
		daysSinceValidation: Number(r.days),
	}));
}

/**
 * Entries that have been invalidated repeatedly in the last 30 days
 * AND currently carry low trust. These are the candidates for
 * `memory poison` / deprecation: they churn and break things.
 */
export async function fetchPoisonCandidates(
	sql: postgres.Sql,
	limit: number,
): Promise<PoisonCandidateRow[]> {
	const rows = await sql<
		{ entry_id: string; title: string; trust_score: number; inv_count: number }[]
	>`
    SELECT
      me.id          AS entry_id,
      me.title       AS title,
      me.trust_score AS trust_score,
      COUNT(mev.id)::int AS inv_count
    FROM memory_entries me
    JOIN memory_events mev
      ON mev.entry_id = me.id
     AND mev.event_type = 'entry_invalidated'
     AND mev.occurred_at > NOW() - (${POISON_WINDOW_DAYS} || ' days')::interval
    WHERE me.trust_status = 'validated'
      AND me.trust_score < ${POISON_TRUST_MAX}
    GROUP BY me.id, me.title, me.trust_score
    HAVING COUNT(mev.id) >= ${POISON_MIN_INVALIDATIONS}
    ORDER BY inv_count DESC, me.trust_score ASC
    LIMIT ${limit}
  `;
	return rows.map((r) => ({
		entryId: r.entry_id,
		title: r.title,
		trustScore: Number(r.trust_score),
		invalidationCount: Number(r.inv_count),
	}));
}

export interface ContradictionFilter {
	repository?: string;
	since?: Date;
	limit?: number;
}

/**
 * Unresolved contradictions with optional `repository` / `since` filters.
 * Powers both `memory contradictions` (drill-down CLI) and the digest.
 */
export async function fetchContradictions(
	sql: postgres.Sql,
	filter: ContradictionFilter = {},
): Promise<
	Array<{
		id: string;
		entryAId: string;
		entryATitle: string;
		entryBId: string;
		entryBTitle: string;
		description: string;
		createdAt: Date;
	}>
> {
	const { repository, since, limit = 50 } = filter;
	const rows = await sql`
    SELECT
      mc.id,
      mc.entry_a_id, ea.title AS entry_a_title, ea.scope AS ea_scope,
      mc.entry_b_id, eb.title AS entry_b_title, eb.scope AS eb_scope,
      mc.description, mc.created_at
    FROM memory_contradictions mc
    JOIN memory_entries ea ON ea.id = mc.entry_a_id
    JOIN memory_entries eb ON eb.id = mc.entry_b_id
    WHERE mc.resolved_at IS NULL
      ${since ? sql`AND mc.created_at >= ${since}` : sql``}
      ${repository ? sql`AND (ea.scope->>'repository' = ${repository} OR eb.scope->>'repository' = ${repository})` : sql``}
    ORDER BY mc.created_at DESC
    LIMIT ${limit}
  `;
	return rows.map((r) => ({
		id: r.id as string,
		entryAId: r.entry_a_id as string,
		entryATitle: r.entry_a_title as string,
		entryBId: r.entry_b_id as string,
		entryBTitle: r.entry_b_title as string,
		description: r.description as string,
		createdAt: new Date(r.created_at as string),
	}));
}
