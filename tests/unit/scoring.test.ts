import { describe, it, expect } from "vitest";
import { calculateTrustScore, calculateExpiryDate } from "../../src/trust/scoring.js";

describe("Trust Scoring", () => {
  describe("calculateTrustScore", () => {
    it("gives low score with no evidence", () => {
      const score = calculateTrustScore({
        evidenceCount: 0,
        impactLevel: "normal",
        accessCount: 0,
        daysSinceValidation: 0,
        knowledgeClass: "semi_stable",
      });
      expect(score).toBe(0.2);
    });

    it("gives higher score with sufficient evidence", () => {
      const score = calculateTrustScore({
        evidenceCount: 2,
        impactLevel: "normal",
        accessCount: 0,
        daysSinceValidation: 0,
        knowledgeClass: "semi_stable",
      });
      expect(score).toBeGreaterThan(0.7);
    });

    it("caps critical entries with single evidence at 0.7", () => {
      const score = calculateTrustScore({
        evidenceCount: 1,
        impactLevel: "critical",
        accessCount: 0,
        daysSinceValidation: 0,
        knowledgeClass: "evergreen",
      });
      expect(score).toBeLessThanOrEqual(0.7);
    });

    it("caps high-impact entries with single evidence at 0.85", () => {
      const score = calculateTrustScore({
        evidenceCount: 1,
        impactLevel: "high",
        accessCount: 0,
        daysSinceValidation: 0,
        knowledgeClass: "semi_stable",
      });
      expect(score).toBeLessThanOrEqual(0.85);
    });

    it("boosts score with high access count (Ebbinghaus)", () => {
      const baseScore = calculateTrustScore({
        evidenceCount: 2,
        impactLevel: "normal",
        accessCount: 0,
        daysSinceValidation: 0,
        knowledgeClass: "semi_stable",
      });

      const boostedScore = calculateTrustScore({
        evidenceCount: 2,
        impactLevel: "normal",
        accessCount: 50,
        daysSinceValidation: 0,
        knowledgeClass: "semi_stable",
      });

      expect(boostedScore).toBeGreaterThan(baseScore);
    });

    it("decays score as TTL approaches expiry", () => {
      const freshScore = calculateTrustScore({
        evidenceCount: 2,
        impactLevel: "normal",
        accessCount: 0,
        daysSinceValidation: 0,
        knowledgeClass: "semi_stable",
      });

      const decayedScore = calculateTrustScore({
        evidenceCount: 2,
        impactLevel: "normal",
        accessCount: 0,
        daysSinceValidation: 25, // Close to 30d TTL for semi_stable
        knowledgeClass: "semi_stable",
      });

      expect(decayedScore).toBeLessThan(freshScore);
    });

    it("never goes below 0 or above 1", () => {
      const extremeLow = calculateTrustScore({
        evidenceCount: 0,
        impactLevel: "critical",
        accessCount: 0,
        daysSinceValidation: 365,
        knowledgeClass: "volatile",
      });

      const extremeHigh = calculateTrustScore({
        evidenceCount: 10,
        impactLevel: "low",
        accessCount: 100,
        daysSinceValidation: 0,
        knowledgeClass: "evergreen",
      });

      expect(extremeLow).toBeGreaterThanOrEqual(0);
      expect(extremeHigh).toBeLessThanOrEqual(1);
    });
  });

  describe("calculateExpiryDate", () => {
    it("returns base TTL with no accesses", () => {
      const from = new Date("2026-01-01");
      const expiry = calculateExpiryDate({ knowledgeClass: "semi_stable", accessCount: 0, from });
      const days = Math.round((expiry.getTime() - from.getTime()) / (1000 * 60 * 60 * 24));
      expect(days).toBe(30);
    });

    it("extends TTL with accesses (Ebbinghaus boost)", () => {
      const from = new Date("2026-01-01");
      const expiry = calculateExpiryDate({ knowledgeClass: "semi_stable", accessCount: 20, from });
      const days = Math.round((expiry.getTime() - from.getTime()) / (1000 * 60 * 60 * 24));
      expect(days).toBe(30 + 2 * 7); // 30 base + 2×7 boost for 20 accesses
    });

    it("respects TTL cap", () => {
      const from = new Date("2026-01-01");
      const expiry = calculateExpiryDate({ knowledgeClass: "volatile", accessCount: 1000, from });
      const days = Math.round((expiry.getTime() - from.getTime()) / (1000 * 60 * 60 * 24));
      expect(days).toBeLessThanOrEqual(30); // Volatile cap is 30 days
    });

    it("calculates evergreen TTL correctly", () => {
      const from = new Date("2026-01-01");
      const expiry = calculateExpiryDate({ knowledgeClass: "evergreen", accessCount: 0, from });
      const days = Math.round((expiry.getTime() - from.getTime()) / (1000 * 60 * 60 * 24));
      expect(days).toBe(90);
    });
  });
});
