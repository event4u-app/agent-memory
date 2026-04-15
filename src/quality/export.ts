import type postgres from "postgres";
import { logger } from "../utils/logger.js";

export interface MemorySnapshot {
  exportedAt: string;
  version: string;
  entries: SnapshotEntry[];
  contradictions: SnapshotContradiction[];
  stats: { total: number; byStatus: Record<string, number>; byType: Record<string, number> };
}

interface SnapshotEntry {
  id: string;
  type: string;
  title: string;
  summary: string;
  scope: unknown;
  impactLevel: string;
  knowledgeClass: string;
  consolidationTier: string;
  trustStatus: string;
  trustScore: number;
  accessCount: number;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

interface SnapshotContradiction {
  id: string;
  entryAId: string;
  entryBId: string;
  description: string;
  resolved: boolean;
}

/**
 * Export the complete memory state as a structured snapshot.
 * Useful for versioning, backup, and diffing between snapshots.
 */
export async function exportSnapshot(
  sql: postgres.Sql,
  options: { includeArchived?: boolean } = {},
): Promise<MemorySnapshot> {
  const statusFilter = options.includeArchived
    ? sql``
    : sql`WHERE trust_status != 'archived'`;

  const entries = await sql`
    SELECT id, type, title, summary, scope, impact_level, knowledge_class,
           consolidation_tier, trust_status, trust_score, access_count,
           created_by, created_at, updated_at
    FROM memory_entries ${statusFilter}
    ORDER BY created_at ASC
  `;

  const contradictions = await sql`
    SELECT id, entry_a_id, entry_b_id, description, resolved_at
    FROM memory_contradictions
    ORDER BY created_at ASC
  `;

  const statusCounts = await sql`
    SELECT trust_status, COUNT(*)::int AS count
    FROM memory_entries GROUP BY trust_status
  `;

  const typeCounts = await sql`
    SELECT type, COUNT(*)::int AS count
    FROM memory_entries GROUP BY type
  `;

  const snapshot: MemorySnapshot = {
    exportedAt: new Date().toISOString(),
    version: "1.0.0",
    entries: entries.map((r) => ({
      id: r.id as string,
      type: r.type as string,
      title: r.title as string,
      summary: r.summary as string,
      scope: r.scope,
      impactLevel: r.impact_level as string,
      knowledgeClass: r.knowledge_class as string,
      consolidationTier: r.consolidation_tier as string,
      trustStatus: r.trust_status as string,
      trustScore: r.trust_score as number,
      accessCount: r.access_count as number,
      createdBy: r.created_by as string,
      createdAt: (r.created_at as Date).toISOString(),
      updatedAt: (r.updated_at as Date).toISOString(),
    })),
    contradictions: contradictions.map((r) => ({
      id: r.id as string,
      entryAId: r.entry_a_id as string,
      entryBId: r.entry_b_id as string,
      description: r.description as string,
      resolved: !!r.resolved_at,
    })),
    stats: {
      total: entries.length,
      byStatus: Object.fromEntries(statusCounts.map((r) => [r.trust_status as string, r.count as number])),
      byType: Object.fromEntries(typeCounts.map((r) => [r.type as string, r.count as number])),
    },
  };

  logger.info({ entries: entries.length }, "Memory snapshot exported");
  return snapshot;
}

/**
 * Diff two snapshots: find added, removed, and changed entries.
 */
export function diffSnapshots(
  older: MemorySnapshot,
  newer: MemorySnapshot,
): { added: string[]; removed: string[]; changed: string[] } {
  const olderIds = new Set(older.entries.map((e) => e.id));
  const newerIds = new Set(newer.entries.map((e) => e.id));
  const olderMap = new Map(older.entries.map((e) => [e.id, e]));

  const added = newer.entries.filter((e) => !olderIds.has(e.id)).map((e) => e.id);
  const removed = older.entries.filter((e) => !newerIds.has(e.id)).map((e) => e.id);
  const changed = newer.entries
    .filter((e) => {
      const old = olderMap.get(e.id);
      return old && (old.trustStatus !== e.trustStatus || old.trustScore !== e.trustScore || old.summary !== e.summary);
    })
    .map((e) => e.id);

  return { added, removed, changed };
}
