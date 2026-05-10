import type { MemoryEntry, TrustStatus } from "../types.js";
import { redactSecretsForAudit } from "./secret-guard.js";
import { SECRET_PATTERNS, type SecretConfidence } from "./secret-patterns.js";

/**
 * III1 · DB-Legacy-Scan — pure audit core.
 *
 * Iterates over persisted entries, reports every `SECRET_DETECTED` pattern
 * match (no cleartext), and optionally produces a fix plan: redact the
 * offending fields in place, or archive the entry out of service.
 *
 * Scope mirrors III2 (retrieval filter): only `SECRET_DETECTED` patterns
 * are actionable. High-entropy heuristics and PII classes are excluded —
 * they produce too many false positives on legitimate technical content
 * (hashes, long identifiers) for a cleanup pass that writes to the DB.
 *
 * DB access lives in the CLI / caller. This module is pure so it can be
 * unit-tested without postgres.
 */

/** Fields scanned on every entry. Must stay in sync with the SQL UPDATE. */
export const AUDIT_FIELDS = ["title", "summary", "details", "embeddingText"] as const;
export type AuditField = (typeof AUDIT_FIELDS)[number];

export interface PatternFinding {
	pattern: string;
	provider: string;
	confidence: SecretConfidence;
	/** Fields on the entry that held at least one match. */
	fields: AuditField[];
	/** Total match count across all fields (for triage sorting). */
	count: number;
}

export interface AuditEntryFinding {
	id: string;
	status: TrustStatus;
	findings: PatternFinding[];
}

/** Convenience lookup: pattern name → catalog entry. */
const PATTERN_INDEX: Map<string, (typeof SECRET_PATTERNS)[number]> = new Map(
	SECRET_PATTERNS.filter((p) => p.code === "SECRET_DETECTED").map((p) => [p.name, p]),
);

/**
 * Scan a single entry and produce a structured finding, or `null` if clean.
 * Never returns cleartext. The returned `fields` and `count` are sufficient
 * for triage; the exact offsets stay inside the DB.
 */
export function auditEntry(entry: MemoryEntry): AuditEntryFinding | null {
	const perPattern = new Map<string, { fields: Set<AuditField>; count: number }>();

	for (const field of AUDIT_FIELDS) {
		const value = entry[field];
		if (typeof value !== "string" || value.length === 0) continue;
		// We call the audit redactor only to discover *which* patterns hit —
		// we throw the rewritten text away. scanForSecrets() would also work
		// but returns offset ranges we don't need here.
		for (const { name, code, regex } of SECRET_PATTERNS) {
			if (code !== "SECRET_DETECTED") continue;
			regex.lastIndex = 0;
			const matches = value.match(regex);
			if (!matches || matches.length === 0) continue;
			const existing = perPattern.get(name) ?? { fields: new Set<AuditField>(), count: 0 };
			existing.fields.add(field);
			existing.count += matches.length;
			perPattern.set(name, existing);
		}
	}

	if (perPattern.size === 0) return null;

	const findings: PatternFinding[] = [];
	for (const [name, { fields, count }] of perPattern) {
		const catalog = PATTERN_INDEX.get(name);
		if (!catalog) continue;
		findings.push({
			pattern: name,
			provider: catalog.provider,
			confidence: catalog.confidence,
			fields: [...fields].sort(),
			count,
		});
	}
	findings.sort((a, b) => a.pattern.localeCompare(b.pattern));
	return { id: entry.id, status: entry.trust.status, findings };
}

/**
 * Compute the redacted field patch for `--fix --mode=redact`. Returns null
 * when no field changes (entry was already clean). Callers are expected to
 * then re-embed `embeddingText` via the I3 boundary and persist the patch.
 */
export interface RedactPatch {
	title?: string;
	summary?: string;
	details?: string;
	embeddingText?: string;
	patternsHit: string[];
}

export function planRedactPatch(entry: MemoryEntry): RedactPatch | null {
	const patch: RedactPatch = { patternsHit: [] };
	const seen = new Set<string>();
	const assign = (field: AuditField, original: string | null) => {
		if (typeof original !== "string" || original.length === 0) return;
		const { text, patterns } = redactSecretsForAudit(original);
		if (patterns.size === 0) return;
		for (const p of patterns) seen.add(p);
		// biome-ignore lint/suspicious/noExplicitAny: narrowed writes to known columns
		(patch as any)[field] = text;
	};
	assign("title", entry.title);
	assign("summary", entry.summary);
	assign("details", entry.details);
	assign("embeddingText", entry.embeddingText);
	if (seen.size === 0) return null;
	patch.patternsHit = [...seen].sort();
	return patch;
}

/**
 * Compute the terminal status transition(s) for `--fix --mode=archive`.
 * Respects VALID_TRANSITIONS: `quarantine` cannot go straight to `archived`
 * and must travel via `rejected`. Returns an ordered list of transitions.
 * Already-archived entries return an empty plan (caller records no-op).
 */
export function planArchiveTransitions(
	from: TrustStatus,
): Array<{ from: TrustStatus; to: TrustStatus }> {
	if (from === "archived") return [];
	if (from === "quarantine") {
		return [
			{ from: "quarantine", to: "rejected" },
			{ from: "rejected", to: "archived" },
		];
	}
	return [{ from, to: "archived" }];
}
