import { logger } from "../utils/logger.js";

/**
 * BM25 parameters — tuned for short memory entries (titles, summaries).
 * k1 controls term frequency saturation; b controls length normalization.
 */
const DEFAULT_K1 = 1.2;
const DEFAULT_B = 0.75;

export interface BM25Options {
  k1?: number;
  b?: number;
}

export interface BM25Result {
  id: string;
  score: number;
}

/**
 * Simple tokenizer for BM25 — lowercases, strips punctuation, splits on whitespace.
 * No stemming yet (added later with a proper library).
 */
export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1); // Remove single-char tokens
}

/**
 * Build a term frequency map for a document.
 */
function termFrequency(tokens: string[]): Map<string, number> {
  const tf = new Map<string, number>();
  for (const token of tokens) {
    tf.set(token, (tf.get(token) ?? 0) + 1);
  }
  return tf;
}

/**
 * In-memory BM25 scorer for memory entries.
 * Operates on pre-tokenized documents for efficiency.
 */
export class BM25Scorer {
  private readonly k1: number;
  private readonly b: number;
  private readonly documents: Map<string, { tf: Map<string, number>; length: number }> =
    new Map();
  private readonly df: Map<string, number> = new Map(); // document frequency per term
  private avgDocLength = 0;

  constructor(options: BM25Options = {}) {
    this.k1 = options.k1 ?? DEFAULT_K1;
    this.b = options.b ?? DEFAULT_B;
  }

  /** Index a document (title + summary + details combined). */
  addDocument(id: string, text: string): void {
    const tokens = tokenize(text);
    const tf = termFrequency(tokens);

    this.documents.set(id, { tf, length: tokens.length });

    // Update document frequency
    for (const term of tf.keys()) {
      this.df.set(term, (this.df.get(term) ?? 0) + 1);
    }

    // Recalculate average document length
    let totalLength = 0;
    for (const doc of this.documents.values()) {
      totalLength += doc.length;
    }
    this.avgDocLength = totalLength / this.documents.size;
  }

  /** Remove a document from the index. */
  removeDocument(id: string): void {
    const doc = this.documents.get(id);
    if (!doc) return;

    // Decrease document frequency for each term
    for (const term of doc.tf.keys()) {
      const current = this.df.get(term) ?? 0;
      if (current <= 1) {
        this.df.delete(term);
      } else {
        this.df.set(term, current - 1);
      }
    }

    this.documents.delete(id);

    // Recalculate average
    if (this.documents.size > 0) {
      let totalLength = 0;
      for (const d of this.documents.values()) {
        totalLength += d.length;
      }
      this.avgDocLength = totalLength / this.documents.size;
    } else {
      this.avgDocLength = 0;
    }
  }

  /** Score all documents against a query. Returns sorted results (highest first). */
  search(query: string, limit?: number): BM25Result[] {
    const queryTokens = tokenize(query);
    if (queryTokens.length === 0) return [];

    const N = this.documents.size;
    if (N === 0) return [];

    const results: BM25Result[] = [];

    for (const [id, doc] of this.documents) {
      let score = 0;

      for (const term of queryTokens) {
        const docFreq = this.df.get(term) ?? 0;
        if (docFreq === 0) continue;

        const termFreqInDoc = doc.tf.get(term) ?? 0;
        if (termFreqInDoc === 0) continue;

        // IDF component: log((N - df + 0.5) / (df + 0.5) + 1)
        const idf = Math.log((N - docFreq + 0.5) / (docFreq + 0.5) + 1);

        // TF component with length normalization
        const tfNorm =
          (termFreqInDoc * (this.k1 + 1)) /
          (termFreqInDoc + this.k1 * (1 - this.b + this.b * (doc.length / this.avgDocLength)));

        score += idf * tfNorm;
      }

      if (score > 0) {
        results.push({ id, score });
      }
    }

    results.sort((a, b) => b.score - a.score);

    if (limit !== undefined) {
      return results.slice(0, limit);
    }

    return results;
  }

  /** Current number of indexed documents. */
  get size(): number {
    return this.documents.size;
  }
}
