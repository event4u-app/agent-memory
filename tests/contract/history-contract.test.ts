import { readFileSync } from "node:fs";
import { join } from "node:path";
import Ajv from "ajv";
import addFormats from "ajv-formats";
import { describe, expect, it } from "vitest";
import type { MemoryEvent } from "../../src/db/repositories/memory-event.repository.js";
import { buildHistory, type HistoryV1 } from "../../src/trust/history.service.js";
import type { ImpactLevel, KnowledgeClass, MemoryEntry, TrustStatus } from "../../src/types.js";

const FIXTURE_DIR = join(process.cwd(), "tests/fixtures/retrieval");

function load<T = unknown>(file: string): T {
	return JSON.parse(readFileSync(join(FIXTURE_DIR, file), "utf-8")) as T;
}

const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);
const schema = load("history-v1.schema.json");
const validate = ajv.compile(schema);

function assertValid(label: string, ok: boolean, errors: unknown): void {
	if (!ok) {
		throw new Error(
			`history-v1 validation failed for ${label}: ${JSON.stringify(errors, null, 2)}`,
		);
	}
}

function makeEntry(): MemoryEntry {
	return {
		id: "mem_history_contract",
		type: "architecture_decision",
		title: "contract",
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
		accessCount: 0,
		lastAccessedAt: null,
		createdBy: "agent",
		createdInTask: null,
		createdAt: new Date(),
		updatedAt: new Date(),
		promotionMetadata: {},
	};
}

describe("history contract v1 — schema conformance", () => {
	it("golden-history.json validates against history-v1.schema.json", () => {
		const golden = load<HistoryV1>("golden-history.json");
		const ok = validate(golden);
		assertValid("golden-history.json", ok as boolean, validate.errors);
		expect(ok).toBe(true);
	});

	it("live buildHistory() output validates against the schema", () => {
		const events: MemoryEvent[] = [
			{
				id: "ev-1",
				entryId: "mem_history_contract",
				occurredAt: new Date("2026-01-10T09:00:00.000Z"),
				actor: "agent:pr-bot",
				eventType: "entry_proposed",
				metadata: {},
				before: null,
				after: { status: "quarantine" },
				reason: "init",
			},
			{
				id: "ev-2",
				entryId: "mem_history_contract",
				occurredAt: new Date("2026-01-12T10:30:00.000Z"),
				actor: "system:promote",
				eventType: "entry_promoted",
				metadata: {},
				before: { status: "quarantine", score: 0.5 },
				after: { status: "validated", score: 0.73 },
				reason: "gates passed",
			},
		];
		const out = buildHistory({
			entry: makeEntry(),
			events,
			now: new Date("2026-04-20T00:00:00.000Z"),
		});
		const ok = validate(out);
		assertValid("live buildHistory()", ok as boolean, validate.errors);
		expect(out.contract_version).toBe("history-v1");
		expect(out.timeline).toHaveLength(2);
	});

	it("rejects envelopes with extra top-level keys", () => {
		const tampered = { ...load<HistoryV1>("golden-history.json"), extra: "nope" };
		const ok = validate(tampered);
		expect(ok).toBe(false);
	});

	it("rejects actor_kind outside the allowed enum", () => {
		const tampered = load<HistoryV1>("golden-history.json");
		// @ts-expect-error — deliberately invalid value for negative test
		tampered.timeline[0].events[0].actor_kind = "bot";
		const ok = validate(tampered);
		expect(ok).toBe(false);
	});

	it("rejects bad day format", () => {
		const tampered = load<HistoryV1>("golden-history.json");
		tampered.timeline[0].day = "2026/01/10";
		const ok = validate(tampered);
		expect(ok).toBe(false);
	});
});
