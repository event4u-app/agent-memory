// D1 · runtime-trust + III3 · secret-safety — line envelope shapes for
// `memory export` / `memory import`. Pinned by
// `tests/fixtures/retrieval/export-v1.schema.json`; any additive field
// here must be mirrored there.

export const EXPORT_CONTRACT_VERSION = "export-v1" as const;
export const EXPORT_REDACTION_VERSION = "1" as const;

export interface ExportFilters {
	/** ISO timestamp; entries with `updated_at >= since` only. `null` → no filter. */
	since: string | null;
	/** Repository scope; entries with `scope.repository === repository` only. `null` → no filter. */
	repository: string | null;
}

export interface ExportHeaderLine {
	kind: "header";
	contract_version: typeof EXPORT_CONTRACT_VERSION;
	exported_at: string;
	entry_count: number;
	filters: ExportFilters;
	redaction_version: typeof EXPORT_REDACTION_VERSION;
}

export interface ExportEntryBody {
	id: string;
	type: string;
	title: string;
	summary: string;
	details: string | null;
	scope: {
		repository: string;
		bounded_context?: string | null;
		files: string[];
		symbols: string[];
		modules: string[];
	};
	impact_level: string;
	knowledge_class: string;
	consolidation_tier: string;
	trust: {
		status: string;
		score: number;
		validated_at: string | null;
		expires_at: string;
	};
	embedding_text: string;
	access_count: number;
	last_accessed_at: string | null;
	created_by: string;
	created_in_task: string | null;
	created_at: string;
	updated_at: string;
	promotion_metadata: Record<string, unknown>;
}

export interface ExportEvidenceBody {
	id: string;
	kind: string;
	ref: string;
	details: string | null;
	verified_at: string | null;
	created_at: string;
}

export interface ExportEventBody {
	id: string;
	occurred_at: string;
	actor: string;
	event_type: string;
	metadata: Record<string, unknown>;
	before: Record<string, unknown> | null;
	after: Record<string, unknown> | null;
	reason: string | null;
}

export interface ExportRedaction {
	applied: boolean;
	patterns: string[];
	version: typeof EXPORT_REDACTION_VERSION;
}

export interface ExportEntryLine {
	kind: "entry";
	entry: ExportEntryBody;
	evidence: ExportEvidenceBody[];
	events: ExportEventBody[];
	redaction: ExportRedaction;
}

export type ExportLine = ExportHeaderLine | ExportEntryLine;
