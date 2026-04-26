// D1 · runtime-trust — orchestrates `memory export`: streams memory_entries
// (filtered by `--since` / `--repository`), zips in evidence + events,
// runs the III3 redaction pass, and emits JSONL lines via a writer
// callback so both stdout and a file-like sink work without coupling.

import type { EvidenceRepository } from "../db/repositories/evidence.repository.js";
import type { MemoryEntryRepository } from "../db/repositories/memory-entry.repository.js";
import type { MemoryEventRepository } from "../db/repositories/memory-event.repository.js";
import type { MemoryEntry, MemoryEvidence } from "../types.js";
import { redactEntryLine } from "./redaction.js";
import {
	buildHeader,
	formatLine,
	serializeEntryBody,
	serializeEvents,
	serializeEvidence,
} from "./serialize.js";
import type { ExportEntryLine, ExportFilters } from "./types.js";

export interface ExportOptions {
	/** ISO timestamp; only entries with `updated_at >= since` are exported. */
	since?: string | null;
	/** Repository scope; only entries matching `scope.repository` are exported. */
	repository?: string | null;
	/** Injectable clock — the contract roundtrip test pins this for byte-identical output. */
	now?: Date;
	/** Batch size for the keyset iterator; 500 mirrors `iterateAll()`. */
	batchSize?: number;
}

export interface ExportSummary {
	entry_count: number;
	redacted_count: number;
}

function matchEntry(
	entry: MemoryEntry,
	repository: string | null,
	sinceDate: Date | null,
): boolean {
	if (repository && entry.scope.repository !== repository) return false;
	if (sinceDate && new Date(entry.updatedAt).getTime() < sinceDate.getTime()) return false;
	return true;
}

/**
 * Write JSONL to `write`. `write` is synchronous (matches `process.stdout.write`
 * and `fs.appendFileSync`) and receives one line at a time, each terminated
 * with `\n`. Returns a summary — caller decides how to surface it.
 *
 * Single pass collects matching entries, sorts them by id across the whole
 * export, then emits header + entry lines. Entry-count in the header is
 * honest because we materialise the match set first; for operator-scale
 * exports this sits well under the retrieval budget. Sorting across the
 * full set (not per batch) keeps byte-identical roundtrip stable even if
 * `iterateAll()` page boundaries shift between runs.
 */
export async function runExport(
	deps: {
		entryRepo: MemoryEntryRepository;
		evidenceRepo: EvidenceRepository;
		eventRepo: MemoryEventRepository;
	},
	write: (line: string) => void,
	options: ExportOptions = {},
): Promise<ExportSummary> {
	const now = options.now ?? new Date();
	const sinceDate = options.since ? new Date(options.since) : null;
	const repository = options.repository ?? null;
	const batchSize = options.batchSize ?? 500;

	const collected: MemoryEntry[] = [];
	for await (const batch of deps.entryRepo.iterateAll(batchSize)) {
		for (const e of batch) if (matchEntry(e, repository, sinceDate)) collected.push(e);
	}
	collected.sort((a, b) => a.id.localeCompare(b.id));

	const filters: ExportFilters = {
		since: sinceDate ? sinceDate.toISOString() : null,
		repository,
	};
	write(formatLine(buildHeader({ exportedAt: now, entryCount: collected.length, filters })));

	let redactedCount = 0;
	for (const entry of collected) {
		const [evidenceRows, eventRows] = await Promise.all([
			deps.evidenceRepo.findByEntryId(entry.id) as Promise<MemoryEvidence[]>,
			deps.eventRepo.listByEntry(entry.id, 10000),
		]);

		const entryBody = serializeEntryBody(entry);
		const evidence = serializeEvidence(evidenceRows);
		const events = serializeEvents(eventRows);
		const redacted = redactEntryLine({ entry: entryBody, evidence, events });
		if (redacted.redaction.applied) redactedCount += 1;

		const line: ExportEntryLine = {
			kind: "entry",
			entry: redacted.entry,
			evidence: redacted.evidence,
			events: redacted.events,
			redaction: redacted.redaction,
		};
		write(formatLine(line));
	}

	return { entry_count: collected.length, redacted_count: redactedCount };
}
