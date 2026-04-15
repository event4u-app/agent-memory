import type postgres from "postgres";
import type { MemoryEntry, MemoryScope } from "../types.js";
import type { ContradictionRepository } from "../db/repositories/contradiction.repository.js";
import { logger } from "../utils/logger.js";

export interface ContradictionCandidate {
  entryA: MemoryEntry;
  entryB: MemoryEntry;
  overlapType: "file" | "symbol" | "module" | "bounded_context";
  overlapDetails: string;
}

/**
 * Detects contradictions between memory entries with overlapping scope.
 *
 * Two entries contradict if they:
 * 1. Share scope overlap (same files, symbols, modules, or bounded context)
 * 2. Have the same memory type (both architecture_decisions about the same thing)
 *
 * V1: Scope overlap detection + same type. Agents resolve contradictions manually.
 * V2: Could use embeddings to detect semantic opposition.
 */
export class ContradictionService {
  constructor(
    private readonly sql: postgres.Sql,
    private readonly contradictionRepo: ContradictionRepository,
  ) {}

  /**
   * Find all existing entries that overlap in scope with the given entry.
   * Only checks validated/stale entries (quarantine/rejected/etc. are irrelevant).
   */
  async findOverlapping(entry: MemoryEntry): Promise<MemoryEntry[]> {
    const scope = entry.scope;

    // Build conditions for overlap detection
    const conditions: string[] = [];
    const fileOverlap = scope.files.length > 0;
    const symbolOverlap = scope.symbols.length > 0;
    const moduleOverlap = scope.modules.length > 0;

    if (!fileOverlap && !symbolOverlap && !moduleOverlap) {
      return [];
    }

    // Query entries with overlapping scope using JSONB operators
    const rows = await this.sql`
      SELECT * FROM memory_entries
      WHERE id != ${entry.id}
        AND trust_status IN ('validated', 'stale', 'quarantine')
        AND type = ${entry.type}
        AND scope->>'repository' = ${scope.repository}
        AND (
          ${fileOverlap ? this.sql`scope->'files' ?| ${scope.files}` : this.sql`false`}
          OR ${symbolOverlap ? this.sql`scope->'symbols' ?| ${scope.symbols}` : this.sql`false`}
          OR ${moduleOverlap ? this.sql`scope->'modules' ?| ${scope.modules}` : this.sql`false`}
        )
      ORDER BY updated_at DESC
      LIMIT 20
    `;

    return rows.map((r) => this.mapRow(r));
  }

  /**
   * Check a new/updated entry for contradictions against existing entries.
   * If contradictions found, creates contradiction records and returns them.
   */
  async detectContradictions(entry: MemoryEntry): Promise<ContradictionCandidate[]> {
    const overlapping = await this.findOverlapping(entry);
    const candidates: ContradictionCandidate[] = [];

    for (const existing of overlapping) {
      const overlap = this.describeOverlap(entry.scope, existing.scope);
      if (overlap) {
        candidates.push({
          entryA: entry,
          entryB: existing,
          overlapType: overlap.type,
          overlapDetails: overlap.details,
        });

        // Create contradiction record
        await this.contradictionRepo.create(
          entry.id,
          existing.id,
          `Scope overlap (${overlap.type}): ${overlap.details}. ` +
            `Entry A: "${entry.title}" vs Entry B: "${existing.title}"`,
        );

        logger.warn(
          { entryA: entry.id, entryB: existing.id, overlap: overlap.type },
          "Contradiction detected",
        );
      }
    }

    return candidates;
  }

  private describeOverlap(
    a: MemoryScope,
    b: MemoryScope,
  ): { type: "file" | "symbol" | "module" | "bounded_context"; details: string } | null {
    const sharedFiles = a.files.filter((f) => b.files.includes(f));
    if (sharedFiles.length > 0) {
      return { type: "file", details: `Shared files: ${sharedFiles.join(", ")}` };
    }

    const sharedSymbols = a.symbols.filter((s) => b.symbols.includes(s));
    if (sharedSymbols.length > 0) {
      return { type: "symbol", details: `Shared symbols: ${sharedSymbols.join(", ")}` };
    }

    const sharedModules = a.modules.filter((m) => b.modules.includes(m));
    if (sharedModules.length > 0) {
      return { type: "module", details: `Shared modules: ${sharedModules.join(", ")}` };
    }

    return null;
  }

  private mapRow(row: postgres.Row): MemoryEntry {
    return {
      id: row.id,
      type: row.type,
      title: row.title,
      summary: row.summary,
      details: row.details,
      scope: typeof row.scope === "string" ? JSON.parse(row.scope) : row.scope,
      impactLevel: row.impact_level,
      knowledgeClass: row.knowledge_class,
      consolidationTier: row.consolidation_tier,
      trust: {
        status: row.trust_status,
        score: row.trust_score,
        validatedAt: row.validated_at ? new Date(row.validated_at) : null,
        expiresAt: new Date(row.expires_at),
      },
      embeddingText: row.embedding_text,
      embedding: row.embedding,
      accessCount: row.access_count,
      lastAccessedAt: row.last_accessed_at ? new Date(row.last_accessed_at) : null,
      createdBy: row.created_by,
      createdInTask: row.created_in_task,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    };
  }
}
