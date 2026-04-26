// III3 · secret-safety — per-entry redaction metadata for the export path.
//
// Applies the same SECRET_DETECTED filter used by retrieval
// (`retrieval-redaction.ts`) to the serialised export line, so a row
// that slipped past ingress (legacy row, in-flight upgrade) cannot leak
// out via `memory export`. Marker stays `[REDACTED:retrieve]` on purpose:
// the export is a retrieval pathway from the operator's point of view,
// and audit output keeps a single vocabulary.

import { RETRIEVAL_REDACTION_MARKER } from "../security/retrieval-redaction.js";
import { SECRET_PATTERNS } from "../security/secret-patterns.js";
import type {
	ExportEntryBody,
	ExportEventBody,
	ExportEvidenceBody,
	ExportRedaction,
} from "./types.js";
import { EXPORT_REDACTION_VERSION } from "./types.js";

function redactText(text: string, hits: Set<string>): string {
	let out = text;
	for (const { name, code, regex } of SECRET_PATTERNS) {
		if (code !== "SECRET_DETECTED") continue;
		regex.lastIndex = 0;
		if (!regex.test(out)) continue;
		hits.add(name);
		regex.lastIndex = 0;
		out = out.replace(regex, RETRIEVAL_REDACTION_MARKER);
	}
	return out;
}

function redactNullable(v: string | null, hits: Set<string>): string | null {
	return v == null ? v : redactText(v, hits);
}

export interface RedactionOutput<T> {
	value: T;
	redaction: ExportRedaction;
}

export function redactEntryBody(entry: ExportEntryBody): RedactionOutput<ExportEntryBody> {
	const hits = new Set<string>();
	const next: ExportEntryBody = {
		...entry,
		title: redactText(entry.title, hits),
		summary: redactText(entry.summary, hits),
		details: redactNullable(entry.details, hits),
		embedding_text: redactText(entry.embedding_text, hits),
	};
	return {
		value: next,
		redaction: {
			applied: hits.size > 0,
			patterns: [...hits].sort(),
			version: EXPORT_REDACTION_VERSION,
		},
	};
}

export function redactEvidence(
	rows: ExportEvidenceBody[],
	hits: Set<string>,
): ExportEvidenceBody[] {
	return rows.map((e) => ({
		...e,
		ref: redactText(e.ref, hits),
		details: redactNullable(e.details, hits),
	}));
}

export function redactEvents(rows: ExportEventBody[], hits: Set<string>): ExportEventBody[] {
	return rows.map((ev) => ({
		...ev,
		reason: redactNullable(ev.reason, hits),
	}));
}

export interface RedactLineArgs {
	entry: ExportEntryBody;
	evidence: ExportEvidenceBody[];
	events: ExportEventBody[];
}

export interface RedactLineResult {
	entry: ExportEntryBody;
	evidence: ExportEvidenceBody[];
	events: ExportEventBody[];
	redaction: ExportRedaction;
}

/**
 * Apply the second-pass secret filter across entry text, evidence refs,
 * and event reasons. Event `metadata`/`before`/`after` carry structured
 * state snapshots produced by the trust layer — never user content — so
 * they pass through untouched; extending coverage there would require a
 * schema-aware walker and is out of scope for III3.
 */
export function redactEntryLine(args: RedactLineArgs): RedactLineResult {
	const hits = new Set<string>();
	const entryRes = redactEntryBody(args.entry);
	for (const p of entryRes.redaction.patterns) hits.add(p);
	const evidence = redactEvidence(args.evidence, hits);
	const events = redactEvents(args.events, hits);
	return {
		entry: entryRes.value,
		evidence,
		events,
		redaction: {
			applied: hits.size > 0,
			patterns: [...hits].sort(),
			version: EXPORT_REDACTION_VERSION,
		},
	};
}
