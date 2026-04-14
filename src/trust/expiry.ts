import type { MemoryEntry, TrustStatus } from "../types.js";
import { isValidTransition } from "./transitions.js";
import { logger } from "../utils/logger.js";

/**
 * Check if a memory entry's TTL has expired and it should be auto-staled.
 * Only validated entries can be auto-staled — other statuses are unaffected.
 */
export function isExpired(entry: MemoryEntry, now: Date = new Date()): boolean {
  return entry.trust.expiresAt.getTime() < now.getTime();
}

/**
 * Determine which entries need auto-staling due to TTL expiry.
 * Returns entry IDs that should be transitioned to 'stale'.
 */
export function findExpiredEntries(entries: MemoryEntry[], now: Date = new Date()): string[] {
  const expiredIds: string[] = [];

  for (const entry of entries) {
    if (!isExpired(entry, now)) continue;

    // Only auto-stale entries in statuses that can transition to 'stale'
    if (isValidTransition(entry.trust.status, "stale")) {
      expiredIds.push(entry.id);
    }
  }

  if (expiredIds.length > 0) {
    logger.debug({ count: expiredIds.length }, "Found expired entries for auto-staling");
  }

  return expiredIds;
}

/**
 * Filter entries for retrieval, applying TTL expiry checks.
 * - Expired validated entries are marked as needing staling (returned separately)
 * - Already stale entries pass through with warning flag
 * - Non-servable statuses are filtered out
 */
export interface ExpiryFilterResult {
  /** Entries safe to serve (validated, not expired) */
  servable: MemoryEntry[];
  /** Entries that are stale (expired OR already stale) — serve with warning */
  staleWarning: MemoryEntry[];
  /** Entry IDs that need status transition to 'stale' in the database */
  needsStaling: string[];
  /** Entries filtered out (quarantine, invalidated, rejected, poisoned, archived) */
  filtered: number;
}

const NON_SERVABLE_STATUSES: ReadonlySet<TrustStatus> = new Set([
  "quarantine",
  "invalidated",
  "rejected",
  "poisoned",
  "archived",
]);

export function applyExpiryFilter(
  entries: MemoryEntry[],
  now: Date = new Date()
): ExpiryFilterResult {
  const servable: MemoryEntry[] = [];
  const staleWarning: MemoryEntry[] = [];
  const needsStaling: string[] = [];
  let filtered = 0;

  for (const entry of entries) {
    // Non-servable statuses are always filtered out
    if (NON_SERVABLE_STATUSES.has(entry.trust.status)) {
      filtered++;
      continue;
    }

    // Already stale — serve with warning
    if (entry.trust.status === "stale") {
      staleWarning.push(entry);
      continue;
    }

    // Validated but expired — needs staling, serve with warning
    if (entry.trust.status === "validated" && isExpired(entry, now)) {
      needsStaling.push(entry.id);
      staleWarning.push(entry);
      continue;
    }

    // Validated and not expired — safe to serve
    servable.push(entry);
  }

  return { servable, staleWarning, needsStaling, filtered };
}
