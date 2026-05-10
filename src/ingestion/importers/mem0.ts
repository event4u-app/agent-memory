// D4 · runtime-trust — Mem0 → agent-memory mapper.
//
// Pure function. No DB, no FS, no clock except `opts.now`.
// One Mem0 record (the shape returned by `client.get_all()` /
// `mem0 list --json`, item-level) maps to one ExportEntryLine that
// can be fed straight into importEntries() in the existing pipeline.
//
// Mem0 has no canonical export envelope; we accept the per-item
// JSON shape and derive every agent-memory field from it. Lossy
// fields are preserved verbatim in `promotion_metadata.mem0_raw`
// so a future, smarter mapper can reprocess without re-fetching.

import { randomUUID } from "node:crypto";
import { EXPORT_REDACTION_VERSION, type ExportEntryLine } from "../../export/types.js";
import { TTL_DAYS } from "../../types.js";

export interface Mem0Record {
	id?: string;
	memory?: string;
	text?: string;
	content?: string;
	created_at?: string;
	updated_at?: string;
	categories?: string[];
	metadata?: Record<string, unknown>;
	user_id?: string;
	agent_id?: string;
	app_id?: string;
	run_id?: string;
}

export interface Mem0ConvertOptions {
	/** Required: agent-memory has no equivalent of Mem0's user-scoped store. */
	repository: string;
	/** Trust score for the imported entry. Default 0.5. */
	initialTrust?: number;
	/** When true, status is `quarantine`; default `validated`. */
	quarantine?: boolean;
	/** Reference time used for `validated_at`, `expires_at`, fallback `created_at`. */
	now?: Date;
}

const DEFAULT_TRUST_SCORE = 0.5;
const TITLE_MAX_LENGTH = 80;

function readText(raw: Mem0Record): string {
	const text = raw.memory ?? raw.text ?? raw.content;
	if (typeof text !== "string" || text.trim() === "") {
		throw new Error("mem0 record has no text in memory|text|content");
	}
	return text.trim();
}

function deriveTitle(text: string): string {
	const firstSentence = text.split(/[.!?\n]/, 1)[0]?.trim() ?? text;
	if (firstSentence.length <= TITLE_MAX_LENGTH) return firstSentence;
	return `${firstSentence.slice(0, TITLE_MAX_LENGTH - 1).trimEnd()}…`;
}

function isoOr(fallback: Date, raw: string | undefined): string {
	if (typeof raw === "string" && raw !== "") {
		const parsed = new Date(raw);
		if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
	}
	return fallback.toISOString();
}

function buildDetails(raw: Mem0Record): string | null {
	const extras: Record<string, unknown> = {};
	if (raw.categories && raw.categories.length > 0) extras.categories = raw.categories;
	if (raw.metadata && Object.keys(raw.metadata).length > 0) extras.metadata = raw.metadata;
	if (raw.user_id) extras.user_id = raw.user_id;
	if (raw.agent_id) extras.agent_id = raw.agent_id;
	if (raw.app_id) extras.app_id = raw.app_id;
	if (raw.run_id) extras.run_id = raw.run_id;
	return Object.keys(extras).length === 0 ? null : JSON.stringify(extras);
}

export function convertMem0Record(raw: Mem0Record, opts: Mem0ConvertOptions): ExportEntryLine {
	if (!opts.repository || opts.repository.trim() === "") {
		throw new Error("mem0 import requires --repository (Mem0 has no repo concept)");
	}
	const now = opts.now ?? new Date();
	const text = readText(raw);
	const score = opts.initialTrust ?? DEFAULT_TRUST_SCORE;
	if (score < 0 || score > 1) {
		throw new Error(`initialTrust must be in [0,1], got ${score}`);
	}
	const status = opts.quarantine ? "quarantine" : "validated";
	const validatedAt = opts.quarantine ? null : now.toISOString();
	const expiresAt = new Date(
		now.getTime() + TTL_DAYS.semi_stable * 24 * 60 * 60 * 1000,
	).toISOString();
	const createdAt = isoOr(now, raw.created_at);
	const updatedAt = isoOr(now, raw.updated_at);

	return {
		kind: "entry",
		entry: {
			id: randomUUID(),
			type: "coding_convention",
			title: deriveTitle(text),
			summary: text,
			details: buildDetails(raw),
			scope: {
				repository: opts.repository,
				files: [],
				symbols: [],
				modules: [],
			},
			impact_level: "low",
			knowledge_class: "semi_stable",
			consolidation_tier: "semantic",
			trust: {
				status,
				score,
				validated_at: validatedAt,
				expires_at: expiresAt,
			},
			embedding_text: text,
			access_count: 0,
			last_accessed_at: null,
			created_by: "import:mem0",
			created_in_task: null,
			created_at: createdAt,
			updated_at: updatedAt,
			promotion_metadata: {
				imported_from: "mem0",
				mem0_id: raw.id ?? null,
				mem0_raw: raw as Record<string, unknown>,
			},
		},
		evidence: [],
		events: [],
		redaction: {
			applied: false,
			patterns: [],
			version: EXPORT_REDACTION_VERSION,
		},
	};
}

/**
 * Parse a Mem0-JSONL stream (one record per line, blank lines skipped)
 * and convert each record. First parse error aborts so callers don't
 * land in a partial state — same contract as parseExportJsonl.
 */
export function parseMem0Jsonl(content: string, opts: Mem0ConvertOptions): ExportEntryLine[] {
	const out: ExportEntryLine[] = [];
	const lines = content.split("\n");
	for (let i = 0; i < lines.length; i++) {
		const raw = lines[i];
		if (raw === undefined || raw.trim() === "") continue;
		let parsed: unknown;
		try {
			parsed = JSON.parse(raw);
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			throw new Error(`mem0-jsonl line ${i + 1}: invalid JSON — ${msg}`);
		}
		if (typeof parsed !== "object" || parsed === null) {
			throw new Error(`mem0-jsonl line ${i + 1}: not a JSON object`);
		}
		out.push(convertMem0Record(parsed as Mem0Record, opts));
	}
	return out;
}
