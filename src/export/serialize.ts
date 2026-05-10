// D1 · runtime-trust — pure serializers for the export line envelope.
//
// Kept pure (no DB, no I/O) so they can be composed from any caller:
// the CLI (`memory export`), future HTTP surface, or a test harness.
// The field order is **fixed on purpose** — JSON.stringify honours
// insertion order, and the roundtrip contract test compares byte-level
// equality, so any reshuffle here = CI red.

import type { MemoryEvent } from "../db/repositories/memory-event.repository.js";
import type { MemoryEntry, MemoryEvidence } from "../types.js";
import {
	EXPORT_CONTRACT_VERSION,
	EXPORT_REDACTION_VERSION,
	type ExportEntryBody,
	type ExportEntryLine,
	type ExportEventBody,
	type ExportEvidenceBody,
	type ExportFilters,
	type ExportHeaderLine,
	type ExportRedaction,
} from "./types.js";

function iso(d: Date | null): string | null {
	return d ? new Date(d).toISOString() : null;
}
function isoRequired(d: Date): string {
	return new Date(d).toISOString();
}

export function serializeEntryBody(entry: MemoryEntry): ExportEntryBody {
	return {
		id: entry.id,
		type: entry.type,
		title: entry.title,
		summary: entry.summary,
		details: entry.details,
		scope: {
			repository: entry.scope.repository,
			...(entry.scope.boundedContext !== undefined
				? { bounded_context: entry.scope.boundedContext }
				: {}),
			files: [...entry.scope.files].sort(),
			symbols: [...entry.scope.symbols].sort(),
			modules: [...entry.scope.modules].sort(),
		},
		impact_level: entry.impactLevel,
		knowledge_class: entry.knowledgeClass,
		consolidation_tier: entry.consolidationTier,
		trust: {
			status: entry.trust.status,
			score: entry.trust.score,
			validated_at: iso(entry.trust.validatedAt),
			expires_at: isoRequired(entry.trust.expiresAt),
		},
		embedding_text: entry.embeddingText,
		access_count: entry.accessCount,
		last_accessed_at: iso(entry.lastAccessedAt),
		created_by: entry.createdBy,
		created_in_task: entry.createdInTask,
		created_at: isoRequired(entry.createdAt),
		updated_at: isoRequired(entry.updatedAt),
		promotion_metadata: (entry.promotionMetadata ?? {}) as Record<string, unknown>,
	};
}

export function serializeEvidence(rows: MemoryEvidence[]): ExportEvidenceBody[] {
	return [...rows]
		.sort((a, b) => {
			const t = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
			return t !== 0 ? t : a.id.localeCompare(b.id);
		})
		.map((e) => ({
			id: e.id,
			kind: e.kind,
			ref: e.ref,
			details: e.details,
			verified_at: iso(e.verifiedAt),
			created_at: isoRequired(e.createdAt),
		}));
}

export function serializeEvents(rows: MemoryEvent[]): ExportEventBody[] {
	return [...rows]
		.sort((a, b) => {
			const t = new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime();
			return t !== 0 ? t : a.id.localeCompare(b.id);
		})
		.map((ev) => ({
			id: ev.id,
			occurred_at: isoRequired(ev.occurredAt),
			actor: ev.actor,
			event_type: ev.eventType,
			metadata: ev.metadata ?? {},
			before: ev.before,
			after: ev.after,
			reason: ev.reason,
		}));
}

export interface BuildEntryLineArgs {
	entry: MemoryEntry;
	evidence: MemoryEvidence[];
	events: MemoryEvent[];
	redaction: ExportRedaction;
}

export function buildEntryLine(args: BuildEntryLineArgs): ExportEntryLine {
	return {
		kind: "entry",
		entry: serializeEntryBody(args.entry),
		evidence: serializeEvidence(args.evidence),
		events: serializeEvents(args.events),
		redaction: args.redaction,
	};
}

export interface BuildHeaderArgs {
	exportedAt: Date;
	entryCount: number;
	filters: ExportFilters;
}

export function buildHeader(args: BuildHeaderArgs): ExportHeaderLine {
	return {
		kind: "header",
		contract_version: EXPORT_CONTRACT_VERSION,
		exported_at: isoRequired(args.exportedAt),
		entry_count: args.entryCount,
		filters: args.filters,
		redaction_version: EXPORT_REDACTION_VERSION,
	};
}

/** Serialize a single line with trailing newline, suitable for stdout streaming. */
export function formatLine(line: unknown): string {
	return `${JSON.stringify(line)}\n`;
}
