import { describe, it, expect, vi } from "vitest";
import { softInvalidate, hardInvalidate } from "../../src/invalidation/invalidation-flows.js";
import type { MemoryEntry, TrustStatus } from "../../src/types.js";

function makeEntry(status: TrustStatus): MemoryEntry {
  return {
    id: "entry-1",
    type: "architecture_decision",
    title: "Test",
    summary: "Test",
    details: null,
    scope: { repository: "test", files: [], symbols: [], modules: [] },
    impactLevel: "normal",
    knowledgeClass: "semi_stable",
    consolidationTier: "semantic",
    trust: { status, score: 0.8, validatedAt: new Date(), expiresAt: new Date("2026-06-01") },
    embeddingText: "test",
    embedding: null,
    accessCount: 0,
    lastAccessedAt: null,
    createdBy: "agent",
    createdInTask: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function mockEntryRepo(entry: MemoryEntry) {
  return {
    findById: vi.fn().mockResolvedValue(entry),
    transitionStatus: vi.fn().mockResolvedValue(entry),
  } as any;
}

describe("softInvalidate", () => {
  it("transitions validated → stale", async () => {
    const entry = makeEntry("validated");
    const repo = mockEntryRepo(entry);
    const result = await softInvalidate("entry-1", "test reason", repo);

    expect(result.action).toBe("soft");
    expect(result.toStatus).toBe("stale");
    expect(repo.transitionStatus).toHaveBeenCalledWith("entry-1", "stale", expect.any(String), expect.any(String));
  });

  it("skips already stale entries", async () => {
    const entry = makeEntry("stale");
    const repo = mockEntryRepo(entry);
    const result = await softInvalidate("entry-1", "test", repo);

    expect(result.action).toBe("skipped");
    expect(repo.transitionStatus).not.toHaveBeenCalled();
  });

  it("skips already rejected entries", async () => {
    const entry = makeEntry("rejected");
    const repo = mockEntryRepo(entry);
    const result = await softInvalidate("entry-1", "test", repo);

    expect(result.action).toBe("skipped");
  });
});

describe("hardInvalidate", () => {
  it("transitions validated → invalidated", async () => {
    const entry = makeEntry("validated");
    const repo = mockEntryRepo(entry);
    const result = await hardInvalidate("entry-1", "file deleted", repo);

    expect(result.action).toBe("hard");
    expect(result.toStatus).toBe("invalidated");
    expect(repo.transitionStatus).toHaveBeenCalledWith("entry-1", "invalidated", expect.any(String), expect.any(String));
  });

  it("transitions stale → invalidated", async () => {
    const entry = makeEntry("stale");
    const repo = mockEntryRepo(entry);
    const result = await hardInvalidate("entry-1", "symbol removed", repo);

    expect(result.action).toBe("hard");
    expect(result.toStatus).toBe("invalidated");
  });

  it("skips already invalidated entries", async () => {
    const entry = makeEntry("invalidated");
    const repo = mockEntryRepo(entry);
    const result = await hardInvalidate("entry-1", "test", repo);

    expect(result.action).toBe("skipped");
  });

  it("skips poisoned entries", async () => {
    const entry = makeEntry("poisoned");
    const repo = mockEntryRepo(entry);
    const result = await hardInvalidate("entry-1", "test", repo);

    expect(result.action).toBe("skipped");
  });
});
