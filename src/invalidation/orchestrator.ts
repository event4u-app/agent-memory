import type postgres from "postgres";
import type { EvidenceRepository } from "../db/repositories/evidence.repository.js";
import type { MemoryEntryRepository } from "../db/repositories/memory-entry.repository.js";
import type { MemoryEntry } from "../types.js";
import { logger } from "../utils/logger.js";
import { type DiffResult, readGitDiff, readGitDiffSince } from "./git-diff.js";
import { hardInvalidate, softInvalidate } from "./invalidation-flows.js";
import { detectDrift } from "./semantic-drift.js";
import {
	matchFileWatches,
	matchSymbolWatches,
	type WatchMatch,
} from "./watchers.js";

export interface InvalidationRunResult {
	/** Git diff summary */
	diff: { filesChanged: number; fromRef: string; toRef: string };
	/** Watch matches found */
	watchMatches: number;
	/** Entries soft-invalidated (stale) */
	softInvalidated: number;
	/** Entries hard-invalidated (rejected) */
	hardInvalidated: number;
	/** Entries with semantic drift detected */
	driftDetected: number;
	/** Entries skipped (already invalid) */
	skipped: number;
}

export interface InvalidationRunOptions {
	root: string;
	/** Git ref to compare from (e.g. commit hash, branch) */
	fromRef?: string;
	/** Or: compare changes since a date */
	sinceDate?: string;
	/** Git ref to compare to (default: HEAD) */
	toRef?: string;
}

/**
 * Invalidation orchestrator: ties git diff + watchers + drift + flows together.
 *
 * Call this after code changes (e.g. after git pull, after a coding session)
 * to update memory trust status based on what changed in the codebase.
 */
export class InvalidationOrchestrator {
	constructor(
		private readonly sql: postgres.Sql,
		private readonly entryRepo: MemoryEntryRepository,
		private readonly evidenceRepo: EvidenceRepository,
	) {}

	async run(options: InvalidationRunOptions): Promise<InvalidationRunResult> {
		// 1. Get git diff
		let diff: DiffResult;
		if (options.fromRef) {
			diff = await readGitDiff(options.root, options.fromRef, options.toRef);
		} else if (options.sinceDate) {
			diff = await readGitDiffSince(options.root, options.sinceDate);
		} else {
			throw new Error("Either fromRef or sinceDate is required");
		}

		if (diff.changes.length === 0) {
			return {
				diff: { filesChanged: 0, fromRef: diff.fromRef, toRef: diff.toRef },
				watchMatches: 0,
				softInvalidated: 0,
				hardInvalidated: 0,
				driftDetected: 0,
				skipped: 0,
			};
		}

		// 2. Load all active entries
		const activeRows = await this.sql`
      SELECT * FROM memory_entries
      WHERE trust_status IN ('validated', 'stale')
      LIMIT 500
    `;
		const entries: MemoryEntry[] = activeRows.map((r) => this.mapRow(r));

		// 3. Match against watches
		const fileMatches = matchFileWatches(entries, diff.changes);
		const symbolMatches = matchSymbolWatches(entries, diff.changes);
		const allMatches = [...fileMatches, ...symbolMatches];

		// Deduplicate by entryId
		const affectedEntryIds = [...new Set(allMatches.map((m) => m.entryId))];

		let softCount = 0;
		let hardCount = 0;
		let driftCount = 0;
		let skipCount = 0;

		// 4. Process each affected entry
		for (const entryId of affectedEntryIds) {
			const entry = entries.find((e) => e.id === entryId);
			if (!entry) {
				skipCount++;
				continue;
			}

			const matches = allMatches.filter((m) => m.entryId === entryId);
			const hasHighSeverity = matches.some((m) => m.severity === "high");
			const hasDeletedFile = matches.some((m) => m.change.isDeleted);

			// 5. Check semantic drift for symbol matches
			const hasSymbolMatch = matches.some((m) => m.matchType === "symbol");
			if (hasSymbolMatch) {
				const evidence = await this.evidenceRepo.findByEntryId(entryId);
				const drift = await detectDrift(entry, evidence, options.root);
				if (drift.shouldInvalidate) {
					driftCount++;
					await hardInvalidate(
						entryId,
						`Semantic drift: ${drift.driftedSymbols.map((s) => s.symbolName).join(", ")}`,
						this.entryRepo,
					);
					hardCount++;
					continue;
				}
			}

			// 6. Apply invalidation based on severity
			if (hasDeletedFile) {
				await hardInvalidate(
					entryId,
					`Watched file deleted: ${matches.find((m) => m.change.isDeleted)?.matched}`,
					this.entryRepo,
				);
				hardCount++;
			} else if (hasHighSeverity) {
				await softInvalidate(
					entryId,
					`Major changes in watched files`,
					this.entryRepo,
				);
				softCount++;
			} else {
				await softInvalidate(
					entryId,
					`Minor changes in watched files`,
					this.entryRepo,
				);
				softCount++;
			}
		}

		logger.info(
			{
				filesChanged: diff.changes.length,
				matches: allMatches.length,
				soft: softCount,
				hard: hardCount,
				drift: driftCount,
			},
			"Invalidation run complete",
		);

		return {
			diff: {
				filesChanged: diff.changes.length,
				fromRef: diff.fromRef,
				toRef: diff.toRef,
			},
			watchMatches: allMatches.length,
			softInvalidated: softCount,
			hardInvalidated: hardCount,
			driftDetected: driftCount,
			skipped: skipCount,
		};
	}

	private mapRow(row: postgres.Row): MemoryEntry {
		return {
			id: row.id,
			type: row.type,
			title: row.title,
			summary: row.summary,
			details: row.details,
			scope: typeof row.scope === "string" ? JSON.parse(row.scope) : row.scope,
			impactLevel: row.impact_level,
			knowledgeClass: row.knowledge_class,
			consolidationTier: row.consolidation_tier,
			trust: {
				status: row.trust_status,
				score: row.trust_score,
				validatedAt: row.validated_at ? new Date(row.validated_at) : null,
				expiresAt: new Date(row.expires_at),
			},
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
			promotionMetadata:
				typeof row.promotion_metadata === "string"
					? JSON.parse(row.promotion_metadata)
					: (row.promotion_metadata ?? {}),
		};
	}
}
