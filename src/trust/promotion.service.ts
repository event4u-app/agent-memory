/**
 * Promotion flow service — propose → promote → deprecate → prune.
 *
 * Wraps existing repositories and the QuarantineService in the API surface
 * required by `agents/roadmaps/from-agent-config/road-to-promotion-flow.md`.
 *
 * The agent never mutates team truth on its own: propose() lands in
 * quarantine with trust < threshold, promote() runs the gate criteria,
 * deprecate() is an explicit human action, prune() is a hygiene run.
 */

import type postgres from "postgres";
import { config } from "../config.js";
import type {
	CreateEntryInput,
	MemoryEntryRepository,
} from "../db/repositories/memory-entry.repository.js";
import { purgeArchived, runArchival } from "../quality/archival.js";
import { enforceNoSecrets } from "../security/secret-guard.js";
import type { MemoryEntry, MemoryType } from "../types.js";
import { MIN_FUTURE_SCENARIOS } from "../types.js";
import { logger } from "../utils/logger.js";
import type { QuarantineService } from "./quarantine.service.js";

export interface ProposeInput extends CreateEntryInput {
	/** Where the observation came from — incident id, PR, ADR ref */
	source: string;
	/** Initial confidence reported by the caller (0.0–1.0) */
	confidence: number;
	/**
	 * Three+ plausible future scenarios this entry will inform. Required at promote
	 * time for Critical/High/Normal impact. See road-to-promotion-flow.md,
	 * "3-future-decisions heuristic".
	 */
	futureScenarios?: string[];
	/**
	 * Caller-asserted extraction-guard result at proposal time (tests green,
	 * quality tools clean, diff not only-deletions). `false` → reject on promote.
	 */
	gateCleanAtProposal?: boolean;
}

export interface ProposeResult {
	proposal_id: string;
	status: "quarantine";
	trust_score: number;
}

/**
 * Rejection categories for promote(), used by callers (CLI/MCP) to build
 * actionable feedback without parsing `reason` strings.
 */
export type PromoteRejectionReason =
	| "allowed_target_types"
	| "future_scenarios"
	| "gate_not_clean"
	| "duplicate"
	| "evidence_floor"
	| "validators"
	| "contradictions";

export interface PromoteOptions {
	/**
	 * Types the consumer allows for promotion (from
	 * `.agent-project-settings.memory.promotion.allowed_target_types`).
	 * If provided and `entry.type` is not listed, promote rejects.
	 */
	allowedTargetTypes?: MemoryType[];
	/** Skip the non-duplication check (dangerous — caller accepts the sibling) */
	skipDuplicateCheck?: boolean;
	/** Actor identifier for audit trail (default: "system:promote") */
	triggeredBy?: string;
}

export interface PromoteResult {
	id: string;
	status: "validated" | "rejected";
	trust_score: number;
	reason: string;
	rejection_reason?: PromoteRejectionReason;
	/** On duplicate rejection: id of the existing validated entry */
	existing_id?: string;
}

export interface DeprecateResult {
	id: string;
	status: "invalidated";
	reason: string;
	superseded_by: string | null;
}

export interface PrunePolicy {
	/** Days before archiving invalidated/rejected entries (default: 30) */
	archivalAgeDays?: number;
	/** Days before hard-deleting archived entries (default: 90) */
	purgeAgeDays?: number;
	/** Also run purge after archival (default: false) */
	runPurge?: boolean;
}

export interface PruneResult {
	archived: number;
	purged: number;
	archivedIds: string[];
}

export class PromotionService {
	constructor(
		private readonly sql: postgres.Sql,
		private readonly entryRepo: MemoryEntryRepository,
		private readonly quarantine: QuarantineService,
	) {}

	/**
	 * Propose a new memory entry. Lands in quarantine — not served until promoted.
	 * Callers must provide a `source` (incident/PR/ADR ref) and initial confidence.
	 */
	async propose(input: ProposeInput): Promise<ProposeResult> {
		// Service-layer secret gate — belt-and-suspenders behind CLI/MCP. Throws
		// `SecretViolationError` under reject policy so no DB write occurs. Under
		// redact policy the violation is surfaced via audit log and the write
		// proceeds with whatever the caller already sanitized.
		const violation = enforceNoSecrets(
			{
				title: input.title,
				summary: input.summary,
				details: input.details ?? undefined,
				embeddingText: input.embeddingText,
			},
			config.security.secretPolicy,
		);
		if (violation) {
			logger.warn(
				{
					policy: violation.policy,
					detections: violation.detections.map((d) => ({
						code: d.code,
						pattern: d.pattern,
						field: d.field,
					})),
					source: input.source,
				},
				"secret-guard: ingress violation during propose",
			);
		}

		const entry = await this.entryRepo.create({
			...input,
			promotionMetadata: {
				source: input.source,
				futureScenarios: input.futureScenarios,
				gateCleanAtProposal: input.gateCleanAtProposal,
			},
		});
		const clampedConfidence = Math.max(0, Math.min(1, input.confidence));
		await this.entryRepo.updateTrustScore(entry.id, clampedConfidence);
		logger.info(
			{
				proposalId: entry.id,
				type: input.type,
				source: input.source,
				confidence: clampedConfidence,
				futureScenarios: input.futureScenarios?.length ?? 0,
				gateCleanAtProposal: input.gateCleanAtProposal,
			},
			"Proposal created",
		);
		return {
			proposal_id: entry.id,
			status: "quarantine",
			trust_score: clampedConfidence,
		};
	}

	/**
	 * Promote a quarantined entry. Runs gate criteria from
	 * road-to-promotion-flow.md in order:
	 *   1. allowed_target_types (consumer policy)
	 *   2. extraction-guard clean at proposal time
	 *   3. 3-future-decisions heuristic (skipped for Low impact)
	 *   4. non-duplication against existing semantic/procedural entries
	 *   5. evidence floor + validators + contradictions (delegated to QuarantineService)
	 * Any failure → 'rejected' with a structured `rejection_reason`.
	 */
	async promote(
		proposalId: string,
		optionsOrTriggeredBy: PromoteOptions | string = {},
	): Promise<PromoteResult> {
		// Back-compat: accept a string triggeredBy as legacy second argument.
		const opts: PromoteOptions =
			typeof optionsOrTriggeredBy === "string"
				? { triggeredBy: optionsOrTriggeredBy }
				: optionsOrTriggeredBy;
		const triggeredBy = opts.triggeredBy ?? "system:promote";

		const entry = await this.entryRepo.findById(proposalId);
		if (!entry) throw new Error(`Proposal not found: ${proposalId}`);
		if (entry.trust.status !== "quarantine") {
			throw new Error(`Entry ${proposalId} is not in quarantine (status: ${entry.trust.status})`);
		}

		// Gate 1: allowed_target_types
		if (
			opts.allowedTargetTypes &&
			opts.allowedTargetTypes.length > 0 &&
			!opts.allowedTargetTypes.includes(entry.type)
		) {
			return this.reject(
				entry,
				"allowed_target_types",
				`Type '${entry.type}' not in consumer's allowed_target_types [${opts.allowedTargetTypes.join(", ")}]`,
				triggeredBy,
			);
		}

		// Gate 2: extraction guard
		if (entry.promotionMetadata.gateCleanAtProposal === false) {
			return this.reject(
				entry,
				"gate_not_clean",
				"Extraction guard reported failures at proposal time (gateCleanAtProposal=false)",
				triggeredBy,
			);
		}

		// Gate 3: 3-future-decisions heuristic (skipped for Low impact per spec)
		if (entry.impactLevel !== "low") {
			const scenarios = entry.promotionMetadata.futureScenarios ?? [];
			const nonEmpty = scenarios.filter((s) => s?.trim().length > 0);
			if (nonEmpty.length < MIN_FUTURE_SCENARIOS) {
				return this.reject(
					entry,
					"future_scenarios",
					`3-future-decisions heuristic failed: got ${nonEmpty.length} non-empty scenarios, need ${MIN_FUTURE_SCENARIOS}`,
					triggeredBy,
				);
			}
		}

		// Gate 4: non-duplication
		if (!opts.skipDuplicateCheck) {
			const existing = await this.entryRepo.findSemanticDuplicate(entry);
			if (existing) {
				return this.reject(
					entry,
					"duplicate",
					`Duplicate of existing ${existing.consolidationTier} entry ${existing.id} (same type + overlapping scope)`,
					triggeredBy,
					existing.id,
				);
			}
		}

		// Gate 5+: evidence floor + validators + contradictions (delegated)
		const summary = await this.quarantine.validateEntry(proposalId, triggeredBy);
		if (summary.decision === "validate") {
			return {
				id: proposalId,
				status: "validated",
				trust_score: summary.trustScore,
				reason: summary.reason,
			};
		}
		return {
			id: proposalId,
			status: "rejected",
			trust_score: summary.trustScore,
			reason: summary.reason,
			rejection_reason: this.classifyQuarantineReason(summary.reason),
		};
	}

	private async reject(
		entry: MemoryEntry,
		rejection: PromoteRejectionReason,
		reason: string,
		triggeredBy: string,
		existingId?: string,
	): Promise<PromoteResult> {
		await this.entryRepo.transitionStatus(entry.id, "rejected", reason, triggeredBy);
		logger.info(
			{ proposalId: entry.id, rejection, reason, existingId },
			"Promotion rejected by gate",
		);
		return {
			id: entry.id,
			status: "rejected",
			trust_score: entry.trust.score,
			reason,
			rejection_reason: rejection,
			...(existingId ? { existing_id: existingId } : {}),
		};
	}

	private classifyQuarantineReason(reason: string): PromoteRejectionReason {
		if (reason.startsWith("Unresolved contradictions")) return "contradictions";
		if (reason.startsWith("Insufficient evidence")) return "evidence_floor";
		return "validators";
	}

	/**
	 * Deprecate a validated entry. Transitions to 'invalidated' with a reason,
	 * optionally recording the successor entry id for audit trails.
	 */
	async deprecate(
		id: string,
		reason: string,
		supersededBy: string | null = null,
		triggeredBy = "human:deprecate",
	): Promise<DeprecateResult> {
		const entry = await this.entryRepo.findById(id);
		if (!entry) throw new Error(`Entry not found: ${id}`);
		const fullReason = supersededBy ? `${reason} (superseded_by=${supersededBy})` : reason;
		await this.entryRepo.transitionStatus(id, "invalidated", fullReason, triggeredBy);
		logger.info({ id, reason, supersededBy }, "Entry deprecated");
		return {
			id,
			status: "invalidated",
			reason: fullReason,
			superseded_by: supersededBy,
		};
	}

	/**
	 * Prune terminal-state entries: archive after `archivalAgeDays`, optionally
	 * purge (hard delete) after `purgeAgeDays`.
	 */
	async prune(policy: PrunePolicy = {}): Promise<PruneResult> {
		const archival = await runArchival(this.sql, this.entryRepo, policy.archivalAgeDays);
		let purged = 0;
		if (policy.runPurge) {
			const res = await purgeArchived(this.sql, policy.purgeAgeDays);
			purged = res.purgedCount;
		}
		return {
			archived: archival.archivedCount,
			purged,
			archivedIds: archival.archivedIds,
		};
	}

	/** Introspection: list quarantined entries awaiting promotion. */
	async listPending(limit = 50): Promise<MemoryEntry[]> {
		return this.entryRepo.findByStatus("quarantine", limit);
	}
}
