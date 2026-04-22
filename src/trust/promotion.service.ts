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
import type { MemoryEntry } from "../types.js";
import type { MemoryEntryRepository, CreateEntryInput } from "../db/repositories/memory-entry.repository.js";
import type { QuarantineService } from "./quarantine.service.js";
import { runArchival, purgeArchived } from "../quality/archival.js";
import { logger } from "../utils/logger.js";

export interface ProposeInput extends CreateEntryInput {
  /** Where the observation came from — incident id, PR, ADR ref */
  source: string;
  /** Initial confidence reported by the caller (0.0–1.0) */
  confidence: number;
}

export interface ProposeResult {
  proposal_id: string;
  status: "quarantine";
  trust_score: number;
}

export interface PromoteResult {
  id: string;
  status: "validated" | "rejected";
  trust_score: number;
  reason: string;
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
    const entry = await this.entryRepo.create(input);
    // Persist the source as metadata-free confidence hint; actual evidence is
    // tracked separately via EvidenceRepository when the caller adds sources.
    const clampedConfidence = Math.max(0, Math.min(1, input.confidence));
    await this.entryRepo.updateTrustScore(entry.id, clampedConfidence);
    logger.info(
      { proposalId: entry.id, type: input.type, source: input.source, confidence: clampedConfidence },
      "Proposal created",
    );
    return {
      proposal_id: entry.id,
      status: "quarantine",
      trust_score: clampedConfidence,
    };
  }

  /**
   * Promote a quarantined entry: run gate criteria (validators, evidence count,
   * contradictions). On success → 'validated'. On gate failure → 'rejected'.
   */
  async promote(proposalId: string, triggeredBy = "system:promote"): Promise<PromoteResult> {
    const entry = await this.entryRepo.findById(proposalId);
    if (!entry) throw new Error(`Proposal not found: ${proposalId}`);
    if (entry.trust.status !== "quarantine") {
      throw new Error(`Entry ${proposalId} is not in quarantine (status: ${entry.trust.status})`);
    }
    const summary = await this.quarantine.validateEntry(proposalId, triggeredBy);
    return {
      id: proposalId,
      status: summary.decision === "validate" ? "validated" : "rejected",
      trust_score: summary.trustScore,
      reason: summary.reason,
    };
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
    return { id, status: "invalidated", reason: fullReason, superseded_by: supersededBy };
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
