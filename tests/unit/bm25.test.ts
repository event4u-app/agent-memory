import { describe, it, expect } from "vitest";
import { tokenize, BM25Scorer } from "../../src/retrieval/bm25.js";

describe("BM25", () => {
  describe("tokenize", () => {
    it("lowercases and splits on whitespace", () => {
      expect(tokenize("Hello World")).toEqual(["hello", "world"]);
    });

    it("strips punctuation", () => {
      expect(tokenize("it's a test.")).toEqual(["it", "test"]);
    });

    it("removes single-char tokens", () => {
      expect(tokenize("a b cd")).toEqual(["cd"]);
    });

    it("handles empty string", () => {
      expect(tokenize("")).toEqual([]);
    });
  });

  describe("BM25Scorer", () => {
    it("finds documents matching query terms", () => {
      const scorer = new BM25Scorer();
      scorer.addDocument("1", "React hooks useState useEffect");
      scorer.addDocument("2", "Vue composition API reactive ref");
      scorer.addDocument("3", "React router navigation");

      const results = scorer.search("React hooks");
      expect(results.length).toBeGreaterThan(0);
      expect(results[0]!.id).toBe("1"); // Best match
    });

    it("returns empty for no matches", () => {
      const scorer = new BM25Scorer();
      scorer.addDocument("1", "Python Django REST");
      const results = scorer.search("React hooks");
      expect(results).toEqual([]);
    });

    it("ranks exact matches higher", () => {
      const scorer = new BM25Scorer();
      scorer.addDocument("1", "database migration schema changes");
      scorer.addDocument("2", "database connection pooling");
      scorer.addDocument("3", "migration guide upgrade steps");

      const results = scorer.search("database migration");
      expect(results[0]!.id).toBe("1"); // Contains both terms
    });

    it("respects limit parameter", () => {
      const scorer = new BM25Scorer();
      for (let i = 0; i < 20; i++) {
        scorer.addDocument(`${i}`, `test document number ${i}`);
      }
      const results = scorer.search("test document", 5);
      expect(results.length).toBe(5);
    });

    it("removes documents correctly", () => {
      const scorer = new BM25Scorer();
      scorer.addDocument("1", "unique keyword alpha");
      scorer.addDocument("2", "common words beta");
      expect(scorer.size).toBe(2);

      scorer.removeDocument("1");
      expect(scorer.size).toBe(1);

      const results = scorer.search("alpha");
      expect(results).toEqual([]);
    });

    it("handles empty query", () => {
      const scorer = new BM25Scorer();
      scorer.addDocument("1", "some content");
      expect(scorer.search("")).toEqual([]);
    });

    it("handles empty index", () => {
      const scorer = new BM25Scorer();
      expect(scorer.search("anything")).toEqual([]);
    });
  });
});
