import type { ContradictionRepository } from "../db/repositories/contradiction.repository.js";
import type { EvidenceRepository } from "../db/repositories/evidence.repository.js";
import type { MemoryEntryRepository } from "../db/repositories/memory-entry.repository.js";
import type { MemoryEntry } from "../types.js";
import { MIN_EVIDENCE_COUNT } from "../types.js";
import { logger } from "../utils/logger.js";
import { calculateExpiryDate, calculateTrustScore } from "./scoring.js";
import type { EvidenceValidator, ValidationSummary } from "./validators/types.js";

export class QuarantineService {
	constructor(
		private readonly entryRepo: MemoryEntryRepository,
		private readonly evidenceRepo: EvidenceRepository,
		private readonly contradictionRepo: ContradictionRepository,
		private readonly validators: EvidenceValidator[],
	) {}

	/**
	 * Validate a quarantined entry: run all validators, check contradictions,
	 * then transition to 'validated' or 'rejected'.
	 */
	async validateEntry(entryId: string, triggeredBy = "system"): Promise<ValidationSummary> {
		const entry = await this.entryRepo.findById(entryId);
		if (!entry) throw new Error(`Entry not found: ${entryId}`);
		if (entry.trust.status !== "quarantine") {
			throw new Error(`Entry ${entryId} is not in quarantine (status: ${entry.trust.status})`);
		}

		const evidence = await this.evidenceRepo.findByEntryId(entryId);
		const contradictions = await this.contradictionRepo.findByEntryId(entryId);
		const unresolvedContradictions = contradictions.filter((c) => c.resolvedAt === null);

		// Run all validators
		const results = await Promise.all(this.validators.map((v) => v.validate(entry, evidence)));

		// Check minimum evidence requirement
		const minEvidence = MIN_EVIDENCE_COUNT[entry.impactLevel];
		const hasMinEvidence = evidence.length >= minEvidence;

		// Determine decision
		const failedValidators = results.filter((r) => !r.passed);
		const hasContradictions = unresolvedContradictions.length > 0;

		let decision: "validate" | "reject";
		let reason: string;

		if (hasContradictions) {
			decision = "reject";
			reason = `Unresolved contradictions: ${unresolvedContradictions.length}`;
		} else if (!hasMinEvidence) {
			decision = "reject";
			reason = `Insufficient evidence: ${evidence.length}/${minEvidence} required for ${entry.impactLevel} impact`;
		} else if (failedValidators.length > 0) {
			// If any high-confidence validator fails, reject
			const highConfidenceFails = failedValidators.filter((r) => r.confidence >= 0.7);
			if (highConfidenceFails.length > 0) {
				decision = "reject";
				reason = `Validator failed: ${highConfidenceFails.map((r) => `${r.validator} (${r.reason})`).join("; ")}`;
			} else {
				// Low-confidence failures: still validate but with lower trust
				decision = "validate";
				reason = `Validated with warnings: ${failedValidators.map((r) => r.reason).join("; ")}`;
			}
		} else {
			decision = "validate";
			reason = "All validators passed";
		}

		// Calculate trust score
		const trustScore = this.computeTrustScore(entry, evidence.length, results);

		// Execute the transition
		const toStatus = decision === "validate" ? "validated" : "rejected";
		await this.entryRepo.transitionStatus(entryId, toStatus, reason, triggeredBy);

		if (decision === "validate") {
			await this.entryRepo.updateTrustScore(entryId, trustScore);
			const expiresAt = calculateExpiryDate({
				knowledgeClass: entry.knowledgeClass,
				accessCount: entry.accessCount,
			});
			await this.entryRepo.updateExpiry(entryId, expiresAt);
		}

		// Mark checked evidence as verified
		for (const result of results) {
			if (result.passed) {
				for (const evidenceId of result.checkedEvidenceIds) {
					await this.evidenceRepo.markVerified(evidenceId);
				}
			}
		}

		logger.info({ entryId, decision, trustScore, reason }, "Quarantine validation complete");

		return {
			results,
			decision,
			trustScore,
			reason,
			hasContradictions,
		};
	}

	private computeTrustScore(
		entry: MemoryEntry,
		evidenceCount: number,
		_results: { passed: boolean; confidence: number }[],
	): number {
		return calculateTrustScore({
			evidenceCount,
			impactLevel: entry.impactLevel,
			accessCount: entry.accessCount,
			daysSinceValidation: 0, // freshly validated
			knowledgeClass: entry.knowledgeClass,
		});
	}
}
