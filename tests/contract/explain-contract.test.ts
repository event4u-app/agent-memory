import { readFileSync } from "node:fs";
import { join } from "node:path";
import Ajv from "ajv";
import addFormats from "ajv-formats";
import { describe, expect, it } from "vitest";
import { type ExplainV1, explainEntry } from "../../src/trust/explain.service.js";
import type {
	Contradiction,
	ImpactLevel,
	KnowledgeClass,
	MemoryEntry,
	TrustStatus,
} from "../../src/types.js";

const FIXTURE_DIR = join(process.cwd(), "tests/fixtures/retrieval");

function load<T = unknown>(file: string): T {
	return JSON.parse(readFileSync(join(FIXTURE_DIR, file), "utf-8")) as T;
}

const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);
const schema = load("explain-v1.schema.json");
const validate = ajv.compile(schema);

function assertValid(label: string, ok: boolean, errors: unknown): void {
	if (!ok) {
		throw new Error(
			`explain-v1 validation failed for ${label}: ${JSON.stringify(errors, null, 2)}`,
		);
	}
}

function makeEntry(overrides: Partial<MemoryEntry> = {}): MemoryEntry {
	return {
		id: "mem_contract",
		type: "architecture_decision",
		title: "contract test entry",
		summary: "s",
		details: null,
		scope: { repository: "r", files: [], symbols: [], modules: [] },
		impactLevel: "high" as ImpactLevel,
		knowledgeClass: "semi_stable" as KnowledgeClass,
		consolidationTier: "semantic",
		trust: {
			status: "validated" as TrustStatus,
			score: 0.73,
			validatedAt: new Date("2026-04-10T00:00:00.000Z"),
			expiresAt: new Date("2026-06-01T00:00:00.000Z"),
		},
		embeddingText: "t s",
		embedding: null,
		accessCount: 8,
		lastAccessedAt: null,
		createdBy: "agent",
		createdInTask: null,
		createdAt: new Date(),
		updatedAt: new Date(),
		promotionMetadata: {},
		...overrides,
	};
}

describe("explain contract v1 — schema conformance", () => {
	it("golden-explain.json validates against explain-v1.schema.json", () => {
		const golden = load<ExplainV1>("golden-explain.json");
		const ok = validate(golden);
		assertValid("golden-explain.json", ok as boolean, validate.errors);
		expect(ok).toBe(true);
	});

	it("live explainEntry() output validates against the schema", () => {
		const out = explainEntry({
			entry: makeEntry(),
			evidenceCount: 2,
			events: [],
			contradictions: [],
			now: new Date("2026-04-20T00:00:00.000Z"),
		});
		const ok = validate(out);
		assertValid("live explainEntry()", ok as boolean, validate.errors);
		expect(out.contract_version).toBe("explain-v1");
	});

	it("live output with history + contradictions validates", () => {
		const c: Contradiction = {
			id: "c-1",
			entryAId: "mem_contract",
			entryBId: "mem_other",
			description: "conflicting architecture",
			resolvedAt: null,
			resolution: null,
			createdAt: new Date("2026-03-01T00:00:00.000Z"),
		};
		const out = explainEntry({
			entry: makeEntry(),
			evidenceCount: 3,
			events: [
				{
					id: "ev-1",
					entryId: "mem_contract",
					occurredAt: new Date("2026-01-10T00:00:00.000Z"),
					actor: "agent:x",
					eventType: "entry_proposed",
					metadata: {},
					before: null,
					after: { status: "quarantine" },
					reason: "proposed",
				},
			],
			contradictions: [c],
			now: new Date("2026-04-20T00:00:00.000Z"),
		});
		const ok = validate(out);
		assertValid("history+contradictions", ok as boolean, validate.errors);
		expect(out.promotion_history).toHaveLength(1);
		expect(out.contradictions[0]?.resolved).toBe(false);
	});

	it("rejects envelopes with additional properties at top level", () => {
		const tampered = { ...load<ExplainV1>("golden-explain.json"), extra: "nope" };
		const ok = validate(tampered);
		expect(ok).toBe(false);
	});
});
