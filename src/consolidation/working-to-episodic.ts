import type { Observation } from "../types.js";
import type { ObservationRepository } from "../db/repositories/observation.repository.js";
import type { MemoryEntryRepository, CreateEntryInput } from "../db/repositories/memory-entry.repository.js";
import { logger } from "../utils/logger.js";

export interface EpisodicSummary {
  sessionId: string;
  observationCount: number;
  summary: string;
  sources: string[];
  createdEntryId: string | null;
}

/**
 * Consolidate Working Memory → Episodic Memory.
 * Compresses raw observations from a session into a session summary entry.
 * Called at session end.
 */
export class WorkingToEpisodicConsolidator {
  constructor(
    private readonly observationRepo: ObservationRepository,
    private readonly entryRepo: MemoryEntryRepository,
  ) {}

  /**
   * Consolidate all observations from a session into one episodic entry.
   * Returns null if no observations exist for the session.
   */
  async consolidate(sessionId: string, repository: string): Promise<EpisodicSummary | null> {
    const observations = await this.observationRepo.findBySession(sessionId);

    if (observations.length === 0) {
      logger.debug({ sessionId }, "No observations to consolidate");
      return null;
    }

    const summary = this.compressObservations(observations);
    const sources = [...new Set(observations.map((o) => o.source))];

    const entry = await this.entryRepo.create({
      type: "refactoring_note",
      title: `Session summary: ${sessionId}`,
      summary,
      scope: {
        repository,
        files: [],
        symbols: [],
        modules: [],
      },
      impactLevel: "low",
      knowledgeClass: "volatile",
      consolidationTier: "episodic",
      embeddingText: summary,
      createdBy: "system:consolidation",
      createdInTask: sessionId,
    });

    logger.info(
      { sessionId, observationCount: observations.length, entryId: entry.id },
      "Working → Episodic consolidation complete",
    );

    return {
      sessionId,
      observationCount: observations.length,
      summary,
      sources,
      createdEntryId: entry.id,
    };
  }

  /**
   * Compress observations into a concise summary.
   * V1: Simple concatenation with dedup and truncation.
   * V2: Could use LLM summarization.
   */
  private compressObservations(observations: Observation[]): string {
    // Group by source
    const bySource = new Map<string, string[]>();
    for (const obs of observations) {
      const list = bySource.get(obs.source) ?? [];
      list.push(obs.content);
      bySource.set(obs.source, list);
    }

    const parts: string[] = [];
    for (const [source, contents] of bySource) {
      // Deduplicate and truncate
      const unique = [...new Set(contents)];
      const truncated = unique.slice(0, 10); // Max 10 per source
      parts.push(`[${source}] (${truncated.length}/${unique.length} entries):`);
      for (const content of truncated) {
        const short = content.length > 200 ? content.slice(0, 200) + "…" : content;
        parts.push(`  - ${short}`);
      }
    }

    const result = parts.join("\n");
    // Hard cap at 2000 chars
    return result.length > 2000 ? result.slice(0, 2000) + "\n…(truncated)" : result;
  }
}
