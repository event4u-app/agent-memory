// III3 · secret-safety — unit tests for the export-path redaction filter.
//
// Canary-style: feed known secret patterns through `redactEntryLine` and
// assert the marker lands in every text field, the `redaction.patterns`
// list names the hit, and `applied` flips to true.

import { describe, expect, it } from "vitest";
import { redactEntryLine } from "../../src/export/redaction.js";
import type {
	ExportEntryBody,
	ExportEventBody,
	ExportEvidenceBody,
} from "../../src/export/types.js";
import { RETRIEVAL_REDACTION_MARKER } from "../../src/security/retrieval-redaction.js";

const AWS_KEY = "AKIAIOSFODNN7EXAMPLE"; // classic canary; AKIA + 16 alnum
const CLEAN_ENTRY: ExportEntryBody = {
	id: "00000000-0000-0000-0000-000000000001",
	type: "architecture_decision",
	title: "Invoice total uses gross price",
	summary: "Gross stays canonical across billing.",
	details: null,
	scope: {
		repository: "acme/checkout",
		files: ["src/billing/invoice.ts"],
		symbols: ["calcInvoiceTotal"],
		modules: ["billing"],
	},
	impact_level: "high",
	knowledge_class: "semi_stable",
	consolidation_tier: "semantic",
	trust: {
		status: "validated",
		score: 0.8,
		validated_at: "2026-03-01T10:00:00.000Z",
		expires_at: "2026-06-01T10:00:00.000Z",
	},
	embedding_text: "invoice gross canonical",
	access_count: 0,
	last_accessed_at: null,
	created_by: "agent",
	created_in_task: null,
	created_at: "2026-02-01T00:00:00.000Z",
	updated_at: "2026-03-01T10:00:00.000Z",
	promotion_metadata: {},
};

describe("redactEntryLine — III3 export-path redaction", () => {
	it("passes clean content through untouched, applied=false", () => {
		const res = redactEntryLine({ entry: CLEAN_ENTRY, evidence: [], events: [] });
		expect(res.redaction.applied).toBe(false);
		expect(res.redaction.patterns).toEqual([]);
		expect(res.entry.title).toBe(CLEAN_ENTRY.title);
	});

	it("catches an AWS access key hidden in the summary", () => {
		const tainted: ExportEntryBody = {
			...CLEAN_ENTRY,
			summary: `Gross stays canonical. Key=${AWS_KEY} was leaked.`,
		};
		const res = redactEntryLine({ entry: tainted, evidence: [], events: [] });
		expect(res.redaction.applied).toBe(true);
		expect(res.redaction.patterns).toContain("aws_access_key");
		expect(res.entry.summary).toContain(RETRIEVAL_REDACTION_MARKER);
		expect(res.entry.summary).not.toContain(AWS_KEY);
	});

	it("redacts AWS keys inside evidence.details too", () => {
		const evidence: ExportEvidenceBody[] = [
			{
				id: "e1",
				kind: "file",
				ref: "src/billing/invoice.ts",
				details: `see secret ${AWS_KEY}`,
				verified_at: null,
				created_at: "2026-02-01T00:00:00.000Z",
			},
		];
		const res = redactEntryLine({ entry: CLEAN_ENTRY, evidence, events: [] });
		expect(res.redaction.applied).toBe(true);
		expect(res.redaction.patterns).toContain("aws_access_key");
		expect(res.evidence[0]?.details).toContain(RETRIEVAL_REDACTION_MARKER);
		expect(res.evidence[0]?.details).not.toContain(AWS_KEY);
	});

	it("redacts AWS keys embedded in event.reason text", () => {
		const events: ExportEventBody[] = [
			{
				id: "ev1",
				occurred_at: "2026-02-01T00:00:00.000Z",
				actor: "agent",
				event_type: "entry_proposed",
				metadata: {},
				before: null,
				after: { score: 0 },
				reason: `saw ${AWS_KEY} in the PR diff`,
			},
		];
		const res = redactEntryLine({ entry: CLEAN_ENTRY, evidence: [], events });
		expect(res.redaction.applied).toBe(true);
		expect(res.events[0]?.reason).toContain(RETRIEVAL_REDACTION_MARKER);
		expect(res.events[0]?.reason).not.toContain(AWS_KEY);
	});

	it("leaves structured event.metadata/before/after untouched (documented scope)", () => {
		// metadata is a structured bag — the III3 guard covers user-text
		// fields only. Keep the raw key here as a guard against someone
		// silently widening redaction coverage without updating the docs.
		const events: ExportEventBody[] = [
			{
				id: "ev1",
				occurred_at: "2026-02-01T00:00:00.000Z",
				actor: "agent",
				event_type: "entry_proposed",
				metadata: { note: AWS_KEY },
				before: null,
				after: null,
				reason: null,
			},
		];
		const res = redactEntryLine({ entry: CLEAN_ENTRY, evidence: [], events });
		expect(res.redaction.applied).toBe(false);
		expect(res.events[0]?.metadata).toEqual({ note: AWS_KEY });
	});
});
