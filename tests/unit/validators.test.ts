import { describe, it, expect, vi, beforeEach } from "vitest";
import { FileExistsValidator } from "../../src/trust/validators/file-exists.validator.js";
import { SymbolExistsValidator } from "../../src/trust/validators/symbol-exists.validator.js";
import { TestLinkedValidator } from "../../src/trust/validators/test-linked.validator.js";
import type { MemoryEntry, MemoryEvidence } from "../../src/types.js";

// --- Helpers ---

function makeEntry(overrides: Partial<MemoryEntry> = {}): MemoryEntry {
  return {
    id: "mem_test_1",
    type: "architecture_decision",
    title: "Test entry",
    summary: "Test summary",
    details: null,
    scope: {
      repository: "test-repo",
      files: [],
      symbols: [],
      modules: [],
    },
    impactLevel: "normal",
    knowledgeClass: "semi_stable",
    consolidationTier: "semantic",
    trust: {
      status: "quarantine",
      score: 0,
      validatedAt: null,
      expiresAt: new Date("2026-05-15"),
    },
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

function makeEvidence(overrides: Partial<MemoryEvidence> = {}): MemoryEvidence {
  return {
    id: "ev_1",
    memoryEntryId: "mem_test_1",
    kind: "file",
    ref: "src/index.ts",
    details: null,
    verifiedAt: null,
    createdAt: new Date(),
    ...overrides,
  };
}

// --- FileExistsValidator ---

describe("FileExistsValidator", () => {
  // Uses the actual filesystem — project root has known files
  const repoRoot = process.cwd();
  const validator = new FileExistsValidator(repoRoot);

  it("passes when referenced files exist", async () => {
    const entry = makeEntry({ scope: { repository: "test", files: ["package.json"], symbols: [], modules: [] } });
    const evidence = [makeEvidence({ kind: "file", ref: "package.json" })];

    const result = await validator.validate(entry, evidence);
    expect(result.passed).toBe(true);
    expect(result.confidence).toBeGreaterThanOrEqual(0.8);
  });

  it("fails when referenced files do not exist", async () => {
    const entry = makeEntry({ scope: { repository: "test", files: ["nonexistent-file.xyz"], symbols: [], modules: [] } });
    const evidence = [makeEvidence({ kind: "file", ref: "nonexistent-file.xyz" })];

    const result = await validator.validate(entry, evidence);
    expect(result.passed).toBe(false);
  });

  it("passes with low confidence when no file references exist", async () => {
    const entry = makeEntry();
    const result = await validator.validate(entry, []);
    expect(result.passed).toBe(true);
    expect(result.confidence).toBeLessThanOrEqual(0.3);
  });
});

// --- SymbolExistsValidator ---

describe("SymbolExistsValidator", () => {
  const repoRoot = process.cwd();
  const validator = new SymbolExistsValidator(repoRoot);

  it("passes when symbols are found in referenced files", async () => {
    const entry = makeEntry({
      scope: { repository: "test", files: ["src/types.ts"], symbols: ["MemoryEntry"], modules: [] },
    });
    const evidence = [makeEvidence({ kind: "symbol", ref: "MemoryEntry" })];

    const result = await validator.validate(entry, evidence);
    expect(result.passed).toBe(true);
  });

  it("fails when symbols are not found", async () => {
    const entry = makeEntry({
      scope: { repository: "test", files: ["src/types.ts"], symbols: ["NonExistentClass"], modules: [] },
    });
    const evidence = [makeEvidence({ kind: "symbol", ref: "NonExistentClass" })];

    const result = await validator.validate(entry, evidence);
    expect(result.passed).toBe(false);
  });

  it("passes with low confidence when no symbols to validate", async () => {
    const entry = makeEntry();
    const result = await validator.validate(entry, []);
    expect(result.passed).toBe(true);
    expect(result.confidence).toBeLessThanOrEqual(0.2);
  });
});

// --- TestLinkedValidator ---

describe("TestLinkedValidator", () => {
  const repoRoot = process.cwd();
  const validator = new TestLinkedValidator(repoRoot);

  it("passes when linked test files exist", async () => {
    const evidence = [makeEvidence({ kind: "test", ref: "tests/unit/scoring.test.ts" })];
    const entry = makeEntry();

    const result = await validator.validate(entry, evidence);
    expect(result.passed).toBe(true);
  });

  it("fails when linked test files do not exist", async () => {
    const evidence = [makeEvidence({ kind: "test", ref: "tests/unit/nonexistent.test.ts" })];
    const entry = makeEntry();

    const result = await validator.validate(entry, evidence);
    expect(result.passed).toBe(false);
  });

  it("passes with low confidence when no test evidence linked", async () => {
    const entry = makeEntry();
    const result = await validator.validate(entry, []);
    expect(result.passed).toBe(true);
    expect(result.confidence).toBeLessThanOrEqual(0.1);
  });
});
