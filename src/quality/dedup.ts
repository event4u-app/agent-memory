import type postgres from "postgres";
import type { EvidenceRepository } from "../db/repositories/evidence.repository.js";
import type { MemoryEntryRepository } from "../db/repositories/memory-entry.repository.js";
import { logger } from "../utils/logger.js";

export interface DuplicateGroup {
	/** Entries that are near-duplicates */
	entries: {
		id: string;
		title: string;
		trustScore: number;
		accessCount: number;
	}[];
	/** Overlap reason */
	reason: string;
}

export interface MergeResult {
	/** The surviving entry ID */
	survivorId: string;
	/** Merged (archived) entry IDs */
	mergedIds: string[];
	/** Evidence transferred count */
	evidenceTransferred: number;
}

/**
 * Find near-duplicate entries: same type + overlapping scope (files/symbols).
 * Groups entries that likely describe the same knowledge.
 */
export async function findDuplicates(sql: postgres.Sql): Promise<DuplicateGroup[]> {
	// Find entries with same type + at least one shared file
	const rows = await sql`
    SELECT
      a.id AS id_a, a.title AS title_a, a.trust_score AS score_a, a.access_count AS access_a,
      b.id AS id_b, b.title AS title_b, b.trust_score AS score_b, b.access_count AS access_b,
      a.type
    FROM memory_entries a
    JOIN memory_entries b ON a.id < b.id
      AND a.type = b.type
      AND a.trust_status IN ('validated', 'stale', 'quarantine')
      AND b.trust_status IN ('validated', 'stale', 'quarantine')
      AND a.scope->>'repository' = b.scope->>'repository'
      AND (
        a.scope->'files' ?| ARRAY(SELECT jsonb_array_elements_text(b.scope->'files'))
        OR a.scope->'symbols' ?| ARRAY(SELECT jsonb_array_elements_text(b.scope->'symbols'))
      )
    LIMIT 50
  `;

	// Group by connected components (simple: just pair-based for V1)
	const groups = new Map<string, DuplicateGroup>();
	for (const row of rows) {
		const key = [row.id_a, row.id_b].sort().join(":");
		if (!groups.has(key)) {
			groups.set(key, {
				entries: [
					{
						id: row.id_a as string,
						title: row.title_a as string,
						trustScore: row.score_a as number,
						accessCount: row.access_a as number,
					},
					{
						id: row.id_b as string,
						title: row.title_b as string,
						trustScore: row.score_b as number,
						accessCount: row.access_b as number,
					},
				],
				reason: `Same type (${row.type}), overlapping scope`,
			});
		}
	}

	return Array.from(groups.values());
}

/**
 * Merge duplicate entries: keep the one with highest trust + access, archive the others.
 * Transfers evidence from merged entries to the survivor.
 */
export async function mergeDuplicates(
	group: DuplicateGroup,
	entryRepo: MemoryEntryRepository,
	evidenceRepo: EvidenceRepository,
	_sql: postgres.Sql,
): Promise<MergeResult> {
	// Pick survivor: highest trust score, then highest access count
	const sorted = [...group.entries].sort((a, b) => {
		if (b.trustScore !== a.trustScore) return b.trustScore - a.trustScore;
		return b.accessCount - a.accessCount;
	});

	const survivor = sorted[0]!;
	const toMerge = sorted.slice(1);

	let evidenceTransferred = 0;

	for (const entry of toMerge) {
		// Transfer evidence
		const evidence = await evidenceRepo.findByEntryId(entry.id);
		for (const ev of evidence) {
			await evidenceRepo.create({
				memoryEntryId: survivor.id,
				kind: ev.kind,
				ref: ev.ref,
				details: ev.details ?? undefined,
			});
			evidenceTransferred++;
		}

		// Archive the merged entry
		await entryRepo.transitionStatus(
			entry.id,
			"archived",
			`Merged into ${survivor.id} (duplicate)`,
			"system:dedup",
		);
	}

	logger.info(
		{
			survivorId: survivor.id,
			mergedCount: toMerge.length,
			evidenceTransferred,
		},
		"Duplicate merge complete",
	);

	return {
		survivorId: survivor.id,
		mergedIds: toMerge.map((e) => e.id),
		evidenceTransferred,
	};
}
