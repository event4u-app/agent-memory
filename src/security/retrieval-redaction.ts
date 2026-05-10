import { SECRET_PATTERNS } from "./secret-patterns.js";

/**
 * Retrieval-output second-pass secret filter.
 *
 * Every response leaving `retrieve()` (CLI, MCP, future HTTP) runs through
 * this module so a secret that slipped past ingress — legacy rows, in-flight
 * upgrades, a temporary ingestion-guard bug — cannot leak out at read time.
 *
 * Scope is deliberately narrower than `scanForSecrets`: only
 * `SECRET_DETECTED` patterns are redacted here. High-entropy heuristics and
 * PII/env-value classes are excluded because they cause excessive false
 * positives on legitimate technical content (hashes, IDs, long identifiers)
 * and the retrieval layer cannot distinguish them from real leaks without a
 * field-level policy. III1 (DB legacy scan) closes the remaining gap
 * asynchronously.
 *
 * Marker is `[REDACTED:retrieve]` (roadmap III2 · "Done" criterion) — distinct
 * from `[REDACTED:secret]` (ingress redact-policy) so operators reading
 * audit output can tell *where* the redaction happened.
 */

export const RETRIEVAL_REDACTION_MARKER = "[REDACTED:retrieve]";

export const RETRIEVAL_WARNING_CODE = "RETRIEVE_POST_REDACT" as const;

/**
 * Warning attached to a retrieval envelope when at least one entry had a
 * secret redacted at the output boundary. Shape is contract-stable (additive
 * in the retrieval-v1 schema). `patterns` and `fields` are deliberate
 * extensions beyond the minimal `{ code, entryId }` spec so `memory audit
 * secrets` (III1) and future audit events (IV1) can triage without a
 * follow-up query — neither leaks secret content.
 */
export interface RetrievalWarning {
	code: typeof RETRIEVAL_WARNING_CODE;
	entryId: string;
	/** Canonical pattern names that fired, e.g. `github_token`. Deduplicated, sorted. */
	patterns: string[];
	/** Body field names that contained at least one match. Deduplicated, sorted. */
	fields: string[];
}

interface RedactableEntry {
	id: string;
	body: Record<string, unknown>;
}

export interface RedactionResult<T extends RedactableEntry> {
	entries: T[];
	warnings: RetrievalWarning[];
}

/**
 * Replace every `SECRET_DETECTED` match in `text` with the retrieval marker.
 * Returns the (possibly unchanged) text and the set of pattern names that
 * fired. Never returns the secret content in any form.
 */
function redactText(text: string): { text: string; patterns: Set<string> } {
	let result = text;
	const patterns = new Set<string>();
	for (const { name, code, regex } of SECRET_PATTERNS) {
		if (code !== "SECRET_DETECTED") continue;
		regex.lastIndex = 0;
		if (!regex.test(result)) continue;
		patterns.add(name);
		regex.lastIndex = 0;
		result = result.replace(regex, RETRIEVAL_REDACTION_MARKER);
	}
	return { text: result, patterns };
}

/**
 * Apply the retrieval filter to an array of contract entries (or any shape
 * exposing `{ id, body }`). String fields on `body` are scanned and rewritten
 * in place on a shallow clone; nested arrays of strings (rare but possible on
 * extended bodies) are traversed one level deep. Non-string leaves pass
 * through untouched.
 */
export function redactEntriesForRetrieval<T extends RedactableEntry>(
	entries: T[],
): RedactionResult<T> {
	const warnings: RetrievalWarning[] = [];
	const redactedEntries = entries.map((entry) => {
		const newBody: Record<string, unknown> = {};
		const patterns = new Set<string>();
		const fields = new Set<string>();

		for (const [field, value] of Object.entries(entry.body)) {
			if (typeof value === "string") {
				const { text, patterns: p } = redactText(value);
				if (p.size > 0) {
					for (const name of p) patterns.add(name);
					fields.add(field);
				}
				newBody[field] = text;
				continue;
			}
			if (Array.isArray(value) && value.every((v) => typeof v === "string")) {
				const rewritten = (value as string[]).map((s) => {
					const { text, patterns: p } = redactText(s);
					if (p.size > 0) {
						for (const name of p) patterns.add(name);
						fields.add(field);
					}
					return text;
				});
				newBody[field] = rewritten;
				continue;
			}
			newBody[field] = value;
		}

		if (patterns.size > 0) {
			warnings.push({
				code: RETRIEVAL_WARNING_CODE,
				entryId: entry.id,
				patterns: [...patterns].sort(),
				fields: [...fields].sort(),
			});
		}

		return { ...entry, body: newBody };
	});

	return { entries: redactedEntries, warnings };
}

/**
 * Stand-alone helper for `handleRetrieveDetails` where the response shape is
 * a flat entry rather than a contract body. Applies the same redaction to a
 * known set of string-bearing fields. Returns the warning (or `null`) so the
 * caller can attach it to the response envelope.
 */
export function redactDetailEntry<T extends Record<string, unknown> & { id: string }>(
	entry: T,
	fieldNames: readonly string[],
): { entry: T; warning: RetrievalWarning | null } {
	const patterns = new Set<string>();
	const fields = new Set<string>();
	const updated: Record<string, unknown> = { ...entry };
	for (const field of fieldNames) {
		const value = updated[field];
		if (typeof value !== "string") continue;
		const { text, patterns: p } = redactText(value);
		if (p.size > 0) {
			for (const name of p) patterns.add(name);
			fields.add(field);
			updated[field] = text;
		}
	}
	if (patterns.size === 0) return { entry: entry, warning: null };
	return {
		entry: updated as T,
		warning: {
			code: RETRIEVAL_WARNING_CODE,
			entryId: entry.id,
			patterns: [...patterns].sort(),
			fields: [...fields].sort(),
		},
	};
}
