import { readFileSync } from "node:fs";
import { join } from "node:path";
import Ajv from "ajv";
import addFormats from "ajv-formats";
import { describe, expect, it } from "vitest";
import {
	BACKEND_FEATURES,
	CONTRACT_VERSION,
	computeEnvelopeStatus,
	type HealthResponseV1,
	type RetrieveResponseV1,
	toContractEntry,
} from "../../src/retrieval/contract.js";

const FIXTURE_DIR = join(process.cwd(), "tests/fixtures/retrieval");
const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);
const validateRetrieval = ajv.compile(
	JSON.parse(
		readFileSync(join(FIXTURE_DIR, "retrieval-v1.schema.json"), "utf-8"),
	),
);
const validateHealth = ajv.compile(
	JSON.parse(readFileSync(join(FIXTURE_DIR, "health-v1.schema.json"), "utf-8")),
);

describe("contract builders emit schema-conformant envelopes", () => {
	it("toContractEntry produces valid entry fields", () => {
		const entry = toContractEntry(
			{
				id: "01HTEST00000000000000000000",
				type: "historical-pattern",
				title: "Sample pattern",
				summary: "Sample summary",
				trustScore: 0.8,
				scope: { repository: "x", modules: ["y"] },
				updatedAt: new Date("2026-04-21T00:00:00Z"),
			},
			"operational",
		);

		const envelope: RetrieveResponseV1 = {
			contract_version: CONTRACT_VERSION,
			status: "ok",
			entries: [entry],
			slices: { "historical-pattern": { status: "ok", count: 1 } },
			errors: [],
		};

		const ok = validateRetrieval(envelope);
		if (!ok) throw new Error(JSON.stringify(validateRetrieval.errors, null, 2));
		expect(ok).toBe(true);
	});

	it("computeEnvelopeStatus: all slices ok → ok", () => {
		expect(
			computeEnvelopeStatus(
				{
					a: { status: "ok", count: 2 },
					b: { status: "ok", count: 1 },
				},
				3,
			),
		).toBe("ok");
	});

	it("computeEnvelopeStatus: mixed ok + timeout → partial", () => {
		expect(
			computeEnvelopeStatus(
				{
					a: { status: "ok", count: 1 },
					b: { status: "timeout", count: 0 },
				},
				1,
			),
		).toBe("partial");
	});

	it("computeEnvelopeStatus: all failed + no entries → error", () => {
		expect(
			computeEnvelopeStatus(
				{
					a: { status: "timeout", count: 0 },
					b: { status: "internal", count: 0 },
				},
				0,
			),
		).toBe("error");
	});

	it("empty envelope with entries validates (ok)", () => {
		const envelope: RetrieveResponseV1 = {
			contract_version: CONTRACT_VERSION,
			status: "error",
			entries: [],
			slices: {},
			errors: [],
		};
		const ok = validateRetrieval(envelope);
		if (!ok) throw new Error(JSON.stringify(validateRetrieval.errors, null, 2));
		expect(ok).toBe(true);
	});

	it("health envelope (ok) produced from BACKEND_FEATURES validates", () => {
		const envelope: HealthResponseV1 = {
			contract_version: CONTRACT_VERSION,
			status: "ok",
			backend_version: "0.1.0",
			features: [...BACKEND_FEATURES],
			latency_ms: 5,
		};
		const ok = validateHealth(envelope);
		if (!ok) throw new Error(JSON.stringify(validateHealth.errors, null, 2));
		expect(ok).toBe(true);
		expect(envelope.features).toContain("trust-scoring");
		expect(envelope.features).toContain("decay");
	});

	it("health envelope (error) with counts validates", () => {
		const envelope: HealthResponseV1 = {
			contract_version: CONTRACT_VERSION,
			status: "error",
			backend_version: "0.1.0",
			features: [...BACKEND_FEATURES],
			latency_ms: 2000,
			counts: { error: 1 },
		};
		const ok = validateHealth(envelope);
		if (!ok) throw new Error(JSON.stringify(validateHealth.errors, null, 2));
		expect(ok).toBe(true);
	});

	it("rejects envelope with wrong contract_version", () => {
		const bad = {
			contract_version: 2,
			status: "ok",
			entries: [],
			slices: {},
			errors: [],
		};
		expect(validateRetrieval(bad)).toBe(false);
	});

	it("rejects entry missing required fields", () => {
		const bad = {
			contract_version: 1,
			status: "ok",
			entries: [{ id: "x", type: "t" }],
			slices: {},
			errors: [],
		};
		expect(validateRetrieval(bad)).toBe(false);
	});
});
