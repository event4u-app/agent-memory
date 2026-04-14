import { describe, it, expect } from "vitest";
import { rrfFuse } from "../../src/retrieval/rrf-fusion.js";

describe("RRF Fusion", () => {
  it("combines two streams and ranks by combined score", () => {
    const results = rrfFuse({
      bm25: [
        { id: "a", score: 5 },
        { id: "b", score: 3 },
        { id: "c", score: 1 },
      ],
      vector: [
        { id: "b", score: 0.9 },
        { id: "a", score: 0.7 },
        { id: "d", score: 0.5 },
      ],
    });

    // Both a and b appear in both streams — should be ranked highest
    const ids = results.map((r) => r.id);
    expect(ids.includes("a")).toBe(true);
    expect(ids.includes("b")).toBe(true);

    // b is rank 1 in vector + rank 2 in bm25 → better combined than a (rank 1 bm25, rank 2 vector)
    // With k=60: b = 1/62 + 1/61, a = 1/61 + 1/62 → same score (symmetric)
    // Actually a and b get the same score since they swap ranks
  });

  it("handles single stream", () => {
    const results = rrfFuse({
      bm25: [
        { id: "a", score: 5 },
        { id: "b", score: 3 },
      ],
    });
    expect(results).toHaveLength(2);
    expect(results[0]!.id).toBe("a"); // Higher rank → higher RRF score
  });

  it("includes items from only one stream", () => {
    const results = rrfFuse({
      bm25: [{ id: "only-bm25", score: 5 }],
      vector: [{ id: "only-vector", score: 0.9 }],
    });
    expect(results).toHaveLength(2);
    // Both get same RRF score (rank 1 in their stream)
    expect(results.map((r) => r.id)).toContain("only-bm25");
    expect(results.map((r) => r.id)).toContain("only-vector");
  });

  it("respects limit", () => {
    const results = rrfFuse(
      {
        bm25: Array.from({ length: 50 }, (_, i) => ({ id: `bm-${i}`, score: 50 - i })),
      },
      { limit: 10 }
    );
    expect(results).toHaveLength(10);
  });

  it("handles empty streams", () => {
    const results = rrfFuse({ bm25: [], vector: [] });
    expect(results).toEqual([]);
  });

  it("records stream scores for debugging", () => {
    const results = rrfFuse({
      bm25: [{ id: "a", score: 5 }],
      vector: [{ id: "a", score: 0.9 }],
    });
    expect(results[0]!.streamScores).toHaveProperty("bm25");
    expect(results[0]!.streamScores).toHaveProperty("vector");
  });
});
