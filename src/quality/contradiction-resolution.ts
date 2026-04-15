import type postgres from "postgres";
import type { ContradictionRepository } from "../db/repositories/contradiction.repository.js";
import type { MemoryEntryRepository } from "../db/repositories/memory-entry.repository.js";
import { logger } from "../utils/logger.js";

export interface UnresolvedContradiction {
  id: string;
  entryAId: string;
  entryATitle: string;
  entryBId: string;
  entryBTitle: string;
  description: string;
  createdAt: Date;
}

export type ResolutionStrategy = "keep_a" | "keep_b" | "keep_both" | "reject_both";

export interface ResolutionResult {
  contradictionId: string;
  strategy: ResolutionStrategy;
  keptEntryIds: string[];
  rejectedEntryIds: string[];
}

/**
 * List all unresolved contradictions with entry details.
 */
export async function listUnresolved(sql: postgres.Sql): Promise<UnresolvedContradiction[]> {
  const rows = await sql`
    SELECT
      mc.id,
      mc.entry_a_id, ea.title AS entry_a_title,
      mc.entry_b_id, eb.title AS entry_b_title,
      mc.description, mc.created_at
    FROM memory_contradictions mc
    JOIN memory_entries ea ON ea.id = mc.entry_a_id
    JOIN memory_entries eb ON eb.id = mc.entry_b_id
    WHERE mc.resolved_at IS NULL
    ORDER BY mc.created_at DESC
    LIMIT 50
  `;

  return rows.map((r) => ({
    id: r.id as string,
    entryAId: r.entry_a_id as string,
    entryATitle: r.entry_a_title as string,
    entryBId: r.entry_b_id as string,
    entryBTitle: r.entry_b_title as string,
    description: r.description as string,
    createdAt: new Date(r.created_at as string),
  }));
}

/**
 * Resolve a contradiction with a chosen strategy.
 */
export async function resolveContradiction(
  contradictionId: string,
  strategy: ResolutionStrategy,
  contradictionRepo: ContradictionRepository,
  entryRepo: MemoryEntryRepository,
  sql: postgres.Sql,
): Promise<ResolutionResult> {
  const contradiction = await contradictionRepo.findById(contradictionId);
  if (!contradiction) throw new Error(`Contradiction not found: ${contradictionId}`);

  const kept: string[] = [];
  const rejected: string[] = [];

  switch (strategy) {
    case "keep_a":
      kept.push(contradiction.entryAId);
      rejected.push(contradiction.entryBId);
      await entryRepo.transitionStatus(contradiction.entryBId, "rejected", `Contradiction resolved: keep A`, "human:resolution");
      break;

    case "keep_b":
      kept.push(contradiction.entryBId);
      rejected.push(contradiction.entryAId);
      await entryRepo.transitionStatus(contradiction.entryAId, "rejected", `Contradiction resolved: keep B`, "human:resolution");
      break;

    case "keep_both":
      kept.push(contradiction.entryAId, contradiction.entryBId);
      // Both stay — maybe they're not actually contradictory
      break;

    case "reject_both":
      rejected.push(contradiction.entryAId, contradiction.entryBId);
      await entryRepo.transitionStatus(contradiction.entryAId, "rejected", `Contradiction resolved: reject both`, "human:resolution");
      await entryRepo.transitionStatus(contradiction.entryBId, "rejected", `Contradiction resolved: reject both`, "human:resolution");
      break;
  }

  // Mark contradiction as resolved
  await contradictionRepo.resolve(contradictionId, strategy);

  logger.info(
    { contradictionId, strategy, kept, rejected },
    "Contradiction resolved",
  );

  return {
    contradictionId,
    strategy,
    keptEntryIds: kept,
    rejectedEntryIds: rejected,
  };
}
