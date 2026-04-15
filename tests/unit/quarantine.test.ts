import { describe, it, expect, vi, beforeEach } from "vitest";
import { QuarantineService } from "../../src/trust/quarantine.service.js";
import type { MemoryEntry, MemoryEvidence } from "../../src/types.js";
import type { EvidenceValidator, ValidatorResult } from "../../src/trust/validators/types.js";

// --- Mock Repos ---

function mockEntryRepo(entry: MemoryEntry | null = null) {
  return {
    findById: vi.fn().mockResolvedValue(entry),
    transitionStatus: vi.fn().mockResolvedValue(entry),
    updateTrustScore: vi.fn().mockResolvedValue(undefined),
    updateExpiry: vi.fn().mockResolvedValue(undefined),
  } as any;
}

function mockEvidenceRepo(evidence: MemoryEvidence[] = []) {
  return {
    findByEntryId: vi.fn().mockResolvedValue(evidence),
    markVerified: vi.fn().mockResolvedValue(undefined),
  } as any;
}

function mockContradictionRepo(contradictions: any[] = []) {
  return {
    findByEntryId: vi.fn().mockResolvedValue(contradictions),
  } as any;
}

function passingValidator(name = "test-validator"): EvidenceValidator {
  return {
    name,
    validate: vi.fn().mockResolvedValue({
      validator: name,
      passed: true,
      confidence: 0.8,
      reason: "All good",
      checkedEvidenceIds: ["ev_1"],
    } satisfies ValidatorResult),
  };
}

function failingValidator(name = "test-validator", confidence = 0.8): EvidenceValidator {
  return {
    name,
    validate: vi.fn().mockResolvedValue({
      validator: name,
      passed: false,
      confidence,
      reason: "Something is wrong",
      checkedEvidenceIds: ["ev_1"],
    } satisfies ValidatorResult),
  };
}

function makeEntry(overrides: Partial<MemoryEntry> = {}): MemoryEntry {
  return {
    id: "mem_q1",
    type: "architecture_decision",
    title: "Test",
    summary: "Test summary",
    details: null,
    scope: { repository: "repo", files: [], symbols: [], modules: [] },
    impactLevel: "normal",
    knowledgeClass: "semi_stable",
    consolidationTier: "semantic",
    trust: { status: "quarantine", score: 0, validatedAt: null, expiresAt: new Date("2026-06-01") },
    embeddingText: "test",
    embedding: null,
    accessCount: 0,
    lastAccessedAt: null,
    createdBy: "agent",
    createdInTask: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeEvidence(id = "ev_1"): MemoryEvidence {
  return { id, memoryEntryId: "mem_q1", kind: "file", ref: "src/foo.ts", details: null, verifiedAt: null, createdAt: new Date() };
}

describe("QuarantineService", () => {
  it("validates entry when all validators pass and evidence is sufficient", async () => {
    const entry = makeEntry();
    const evidence = [makeEvidence()];
    const service = new QuarantineService(
      mockEntryRepo(entry), mockEvidenceRepo(evidence), mockContradictionRepo(), [passingValidator()],
    );

    const result = await service.validateEntry("mem_q1");
    expect(result.decision).toBe("validate");
    expect(result.trustScore).toBeGreaterThan(0);
  });

  it("rejects entry when high-confidence validator fails", async () => {
    const entry = makeEntry();
    const evidence = [makeEvidence()];
    const service = new QuarantineService(
      mockEntryRepo(entry), mockEvidenceRepo(evidence), mockContradictionRepo(), [failingValidator("file-exists", 0.9)],
    );

    const result = await service.validateEntry("mem_q1");
    expect(result.decision).toBe("reject");
  });

  it("still validates when low-confidence validator fails", async () => {
    const entry = makeEntry();
    const evidence = [makeEvidence()];
    const service = new QuarantineService(
      mockEntryRepo(entry), mockEvidenceRepo(evidence), mockContradictionRepo(), [failingValidator("weak-check", 0.4)],
    );

    const result = await service.validateEntry("mem_q1");
    expect(result.decision).toBe("validate");
  });

  it("rejects entry with unresolved contradictions", async () => {
    const entry = makeEntry();
    const evidence = [makeEvidence()];
    const contradictions = [{ id: "c1", resolvedAt: null }];
    const service = new QuarantineService(
      mockEntryRepo(entry), mockEvidenceRepo(evidence), mockContradictionRepo(contradictions), [passingValidator()],
    );

    const result = await service.validateEntry("mem_q1");
    expect(result.decision).toBe("reject");
    expect(result.hasContradictions).toBe(true);
  });

  it("rejects critical entry with insufficient evidence", async () => {
    const entry = makeEntry({ impactLevel: "critical" }); // needs 2 evidence
    const evidence = [makeEvidence()]; // only 1
    const service = new QuarantineService(
      mockEntryRepo(entry), mockEvidenceRepo(evidence), mockContradictionRepo(), [passingValidator()],
    );

    const result = await service.validateEntry("mem_q1");
    expect(result.decision).toBe("reject");
    expect(result.reason).toContain("Insufficient evidence");
  });

  it("throws if entry is not in quarantine", async () => {
    const entry = makeEntry({ trust: { status: "validated", score: 0.8, validatedAt: new Date(), expiresAt: new Date("2026-06-01") } });
    const service = new QuarantineService(
      mockEntryRepo(entry), mockEvidenceRepo(), mockContradictionRepo(), [],
    );

    await expect(service.validateEntry("mem_q1")).rejects.toThrow("not in quarantine");
  });
});
