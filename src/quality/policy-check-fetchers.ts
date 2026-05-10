// C2 · runtime-trust — SQL fetchers for the policy engine.
//
// Kept in a separate file so the pure policy logic in
// `policy-check.service.ts` can be unit-tested without a DB. The
// fetchers here are plumbing: one SELECT per policy, repository-scoped
// via `scope->>'repository'`.

import type postgres from "postgres";

import type { EntryRow } from "./policy-check.service.js";

export interface PolicyFetchers {
	fetchContradictedCritical(repository: string | null): Promise<EntryRow[]>;
	fetchInvalidatedAdr(repository: string | null): Promise<EntryRow[]>;
	fetchLowTrustAdr(repository: string | null, threshold: number): Promise<EntryRow[]>;
	fetchPoisoned(repository: string | null): Promise<EntryRow[]>;
}

export function createPolicyFetchers(sql: postgres.Sql): PolicyFetchers {
	return {
		async fetchContradictedCritical(repository) {
			return sql<EntryRow[]>`
				SELECT DISTINCT e.id, e.type, e.title, e.trust_status, e.trust_score, e.impact_level
				FROM memory_entries e
				JOIN memory_contradictions c
				  ON (c.entry_a_id = e.id OR c.entry_b_id = e.id)
				WHERE c.resolved_at IS NULL
				  AND e.impact_level = 'critical'
				  AND (${repository}::text IS NULL OR e.scope->>'repository' = ${repository})
				ORDER BY e.trust_score ASC
			`;
		},
		async fetchInvalidatedAdr(repository) {
			return sql<EntryRow[]>`
				SELECT id, type, title, trust_status, trust_score, impact_level
				FROM memory_entries
				WHERE type = 'architecture_decision'
				  AND trust_status = 'invalidated'
				  AND (${repository}::text IS NULL OR scope->>'repository' = ${repository})
				ORDER BY updated_at DESC
			`;
		},
		async fetchLowTrustAdr(repository, threshold) {
			return sql<EntryRow[]>`
				SELECT id, type, title, trust_status, trust_score, impact_level
				FROM memory_entries
				WHERE type = 'architecture_decision'
				  AND trust_status IN ('validated', 'stale')
				  AND trust_score < ${threshold}
				  AND (${repository}::text IS NULL OR scope->>'repository' = ${repository})
				ORDER BY trust_score ASC
			`;
		},
		async fetchPoisoned(repository) {
			return sql<EntryRow[]>`
				SELECT id, type, title, trust_status, trust_score, impact_level
				FROM memory_entries
				WHERE trust_status = 'poisoned'
				  AND (${repository}::text IS NULL OR scope->>'repository' = ${repository})
				ORDER BY updated_at DESC
			`;
		},
	};
}
