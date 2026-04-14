import {
  TTL_DAYS,
  TTL_BOOST_PER_10_ACCESSES,
  TTL_CAP_DAYS,
  MIN_EVIDENCE_COUNT,
  TRUST_SCORE_CAP_SINGLE_EVIDENCE,
  type KnowledgeClass,
  type ImpactLevel,
} from "../types.js";

/**
 * Calculate trust score based on evidence count, impact level, and access frequency.
 */
export function calculateTrustScore(params: {
  evidenceCount: number;
  impactLevel: ImpactLevel;
  accessCount: number;
  daysSinceValidation: number;
  knowledgeClass: KnowledgeClass;
}): number {
  const { evidenceCount, impactLevel, accessCount, daysSinceValidation, knowledgeClass } = params;

  // Base score from evidence
  const minEvidence = MIN_EVIDENCE_COUNT[impactLevel];
  let score: number;

  if (evidenceCount === 0) {
    score = 0.2;
  } else if (evidenceCount < minEvidence) {
    score = 0.4 + (evidenceCount / minEvidence) * 0.2;
  } else {
    score = 0.7 + Math.min(evidenceCount - minEvidence, 3) * 0.1;
  }

  // Cap for single evidence on high-impact entries
  if (evidenceCount === 1) {
    score = Math.min(score, TRUST_SCORE_CAP_SINGLE_EVIDENCE[impactLevel]);
  }

  // Ebbinghaus boost from access frequency
  const accessBoost = Math.min(accessCount / 50, 0.1); // Max +0.1 from frequent access
  score += accessBoost;

  // Decay from time since last validation
  const ttlDays = TTL_DAYS[knowledgeClass];
  if (daysSinceValidation > ttlDays * 0.5) {
    const decayFactor = Math.min((daysSinceValidation - ttlDays * 0.5) / (ttlDays * 0.5), 1);
    score -= decayFactor * 0.3;
  }

  return Math.max(0, Math.min(1, score));
}

/**
 * Calculate expiry date based on knowledge class and access count (Ebbinghaus boost).
 */
export function calculateExpiryDate(params: {
  knowledgeClass: KnowledgeClass;
  accessCount: number;
  from?: Date;
}): Date {
  const { knowledgeClass, accessCount, from = new Date() } = params;

  const baseDays = TTL_DAYS[knowledgeClass];
  const boostDays = Math.floor(accessCount / 10) * TTL_BOOST_PER_10_ACCESSES[knowledgeClass];
  const capDays = TTL_CAP_DAYS[knowledgeClass];

  const totalDays = Math.min(baseDays + boostDays, capDays);

  const expiry = new Date(from);
  expiry.setDate(expiry.getDate() + totalDays);
  return expiry;
}
