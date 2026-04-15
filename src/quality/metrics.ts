import type postgres from "postgres";
import { logger } from "../utils/logger.js";

export interface QualityMetrics {
  /** Total entries by status */
  statusDistribution: Record<string, number>;
  /** Average trust score of validated entries */
  avgTrustScore: number;
  /** Percentage of expired entries caught on time (TTL compliance) */
  ttlCompliance: number;
  /** Unresolved contradiction count */
  unresolvedContradictions: number;
  /** Quarantine rejection rate (rejected / total that left quarantine) */
  quarantineRejectionRate: number;
  /** Poisoned entry count */
  poisonedCount: number;
  /** Entries expiring within 7 days */
  expiringIn7Days: number;
  /** Stale entries by impact level */
  staleByImpact: Record<string, number>;
  /** Average evidence count per validated entry */
  avgEvidenceCount: number;
  /** Entries with zero access (potentially useless) */
  neverAccessedCount: number;
}

/**
 * Calculate system-wide quality metrics.
 * Designed to be called from memory_health or a scheduled dashboard.
 */
export async function calculateMetrics(sql: postgres.Sql): Promise<QualityMetrics> {
  // Status distribution
  const statusRows = await sql`
    SELECT trust_status, COUNT(*)::int AS count
    FROM memory_entries GROUP BY trust_status
  `;
  const statusDistribution = Object.fromEntries(statusRows.map((r) => [r.trust_status as string, r.count as number]));

  // Average trust score (validated only)
  const [trustRow] = await sql`
    SELECT COALESCE(AVG(trust_score), 0)::float AS avg_trust
    FROM memory_entries WHERE trust_status = 'validated'
  `;
  const avgTrustScore = trustRow?.avg_trust as number ?? 0;

  // TTL compliance: % of entries that were staled before or on expiry date
  // (entries where stale transition happened <= expires_at)
  const [ttlRow] = await sql`
    SELECT
      COUNT(CASE WHEN msh.created_at <= me.expires_at THEN 1 END)::float /
      NULLIF(COUNT(*)::float, 0) AS compliance
    FROM memory_status_history msh
    JOIN memory_entries me ON me.id = msh.memory_entry_id
    WHERE msh.to_status = 'stale'
      AND msh.triggered_by = 'system:ttl-expiry'
  `;
  const ttlCompliance = (ttlRow?.compliance as number) ?? 1.0;

  // Unresolved contradictions
  const [contradictionRow] = await sql`
    SELECT COUNT(*)::int AS count FROM memory_contradictions WHERE resolved_at IS NULL
  `;

  // Quarantine rejection rate
  const [quarantineRow] = await sql`
    SELECT
      COUNT(CASE WHEN to_status = 'rejected' THEN 1 END)::float /
      NULLIF(COUNT(*)::float, 0) AS rejection_rate
    FROM memory_status_history
    WHERE from_status = 'quarantine'
      AND to_status IN ('validated', 'rejected')
  `;

  // Poisoned count
  const [poisonRow] = await sql`
    SELECT COUNT(*)::int AS count FROM memory_entries WHERE trust_status = 'poisoned'
  `;

  // Expiring in 7 days
  const [expiringRow] = await sql`
    SELECT COUNT(*)::int AS count FROM memory_entries
    WHERE trust_status = 'validated'
      AND expires_at BETWEEN NOW() AND NOW() + INTERVAL '7 days'
  `;

  // Stale by impact
  const staleRows = await sql`
    SELECT impact_level, COUNT(*)::int AS count
    FROM memory_entries WHERE trust_status = 'stale'
    GROUP BY impact_level
  `;
  const staleByImpact = Object.fromEntries(staleRows.map((r) => [r.impact_level as string, r.count as number]));

  // Average evidence count
  const [evidenceRow] = await sql`
    SELECT COALESCE(AVG(ev_count), 0)::float AS avg_evidence FROM (
      SELECT me.id, COUNT(mev.id)::int AS ev_count
      FROM memory_entries me
      LEFT JOIN memory_evidence mev ON mev.memory_entry_id = me.id
      WHERE me.trust_status = 'validated'
      GROUP BY me.id
    ) sub
  `;

  // Never accessed
  const [neverAccessedRow] = await sql`
    SELECT COUNT(*)::int AS count FROM memory_entries
    WHERE trust_status = 'validated' AND access_count = 0
  `;

  return {
    statusDistribution,
    avgTrustScore,
    ttlCompliance,
    unresolvedContradictions: contradictionRow?.count as number ?? 0,
    quarantineRejectionRate: (quarantineRow?.rejection_rate as number) ?? 0,
    poisonedCount: poisonRow?.count as number ?? 0,
    expiringIn7Days: expiringRow?.count as number ?? 0,
    staleByImpact,
    avgEvidenceCount: (evidenceRow?.avg_evidence as number) ?? 0,
    neverAccessedCount: neverAccessedRow?.count as number ?? 0,
  };
}
