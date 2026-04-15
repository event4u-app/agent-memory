import type { MemoryEntry } from "../types.js";
import type { MemoryEntryRepository, CreateEntryInput } from "../db/repositories/memory-entry.repository.js";
import { logger } from "../utils/logger.js";

export interface SemanticExtractionResult {
  sourceEntryId: string;
  extractedEntryIds: string[];
  skipped: boolean;
  reason: string;
}

/**
 * Consolidate Episodic Memory → Semantic Memory.
 * Extracts stable knowledge from episodic session summaries.
 * New semantic entries enter quarantine — never directly validated.
 *
 * V1: Pattern-based extraction from summary text.
 * V2: Could use LLM to identify stable knowledge.
 */
export class EpisodicToSemanticExtractor {
  constructor(
    private readonly entryRepo: MemoryEntryRepository,
  ) {}

  /**
   * Attempt to extract semantic knowledge from an episodic entry.
   * Only processes episodic entries that have been accessed (showed usefulness).
   */
  async extract(
    episodicEntry: MemoryEntry,
    repository: string,
  ): Promise<SemanticExtractionResult> {
    if (episodicEntry.consolidationTier !== "episodic") {
      return {
        sourceEntryId: episodicEntry.id,
        extractedEntryIds: [],
        skipped: true,
        reason: "Not an episodic entry",
      };
    }

    if (episodicEntry.accessCount < 1) {
      return {
        sourceEntryId: episodicEntry.id,
        extractedEntryIds: [],
        skipped: true,
        reason: "Episodic entry never accessed — not worth extracting",
      };
    }

    // Extract knowledge facts from the summary
    const facts = this.extractFacts(episodicEntry);

    if (facts.length === 0) {
      return {
        sourceEntryId: episodicEntry.id,
        extractedEntryIds: [],
        skipped: true,
        reason: "No extractable facts found",
      };
    }

    const createdIds: string[] = [];
    for (const fact of facts) {
      const entry = await this.entryRepo.create({
        ...fact,
        scope: {
          ...episodicEntry.scope,
          repository,
        },
        consolidationTier: "semantic",
        createdBy: "system:consolidation",
        createdInTask: episodicEntry.createdInTask ?? undefined,
      });
      createdIds.push(entry.id);
    }

    logger.info(
      { sourceId: episodicEntry.id, extractedCount: createdIds.length },
      "Episodic → Semantic extraction complete",
    );

    return {
      sourceEntryId: episodicEntry.id,
      extractedEntryIds: createdIds,
      skipped: false,
      reason: `Extracted ${createdIds.length} semantic entries`,
    };
  }

  /**
   * Extract discrete facts from an episodic summary.
   * V1: Simple heuristics — look for patterns that indicate stable knowledge.
   */
  private extractFacts(entry: MemoryEntry): Omit<CreateEntryInput, "scope" | "consolidationTier" | "createdBy" | "createdInTask">[] {
    const facts: Omit<CreateEntryInput, "scope" | "consolidationTier" | "createdBy" | "createdInTask">[] = [];
    const summary = entry.summary;

    // Look for decision indicators
    const decisionPatterns = [
      /decided to (.+)/gi,
      /chose (.+?) over/gi,
      /architecture[:\s]+(.+)/gi,
      /pattern[:\s]+(.+)/gi,
    ];

    for (const pattern of decisionPatterns) {
      let match: RegExpExecArray | null;
      pattern.lastIndex = 0;
      while ((match = pattern.exec(summary)) !== null) {
        const fact = match[1]!.trim();
        if (fact.length >= 15 && fact.length <= 300) {
          facts.push({
            type: "architecture_decision",
            title: fact.length > 80 ? fact.slice(0, 80) + "…" : fact,
            summary: fact,
            impactLevel: "normal",
            knowledgeClass: "semi_stable",
            embeddingText: fact,
          });
        }
      }
    }

    // Look for bug/fix patterns
    const bugPatterns = [
      /(?:bug|issue|fix|fixed|problem)[:\s]+(.+)/gi,
      /caused by (.+)/gi,
    ];

    for (const pattern of bugPatterns) {
      let match: RegExpExecArray | null;
      pattern.lastIndex = 0;
      while ((match = pattern.exec(summary)) !== null) {
        const fact = match[1]!.trim();
        if (fact.length >= 15 && fact.length <= 300) {
          facts.push({
            type: "bug_pattern",
            title: fact.length > 80 ? fact.slice(0, 80) + "…" : fact,
            summary: fact,
            impactLevel: "normal",
            knowledgeClass: "volatile",
            embeddingText: fact,
          });
        }
      }
    }

    // Limit to 5 facts per episodic entry
    return facts.slice(0, 5);
  }
}
