import { readFileSync } from "node:fs";
import { join } from "node:path";
import Ajv from "ajv";
import addFormats from "ajv-formats";
import { describe, expect, it } from "vitest";
import type {
	DeprecateResult,
	PromoteResult,
	ProposeResult,
} from "../../src/trust/promotion.service.js";

const FIXTURE_DIR = join(process.cwd(), "tests/fixtures/retrieval");

function load<T = unknown>(file: string): T {
	return JSON.parse(readFileSync(join(FIXTURE_DIR, file), "utf-8")) as T;
}

const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);

const proposeSchema = load("propose-v1.schema.json");
const promoteSchema = load("promote-v1.schema.json");
const deprecateSchema = load("deprecate-v1.schema.json");

const validatePropose = ajv.compile(proposeSchema);
const validatePromote = ajv.compile(promoteSchema);
const validateDeprecate = ajv.compile(deprecateSchema);

interface ProposeResponse {
	proposal_id: string;
	status: "quarantine";
	trust_score: number;
}

interface PromoteResponse {
	id: string;
	status: "validated" | "rejected";
	trust_score: number;
	reason: string;
	rejection_reason?: string;
	existing_id?: string;
}

interface DeprecateResponse {
	id: string;
	status: "invalidated";
	reason: string;
	superseded_by: string | null;
}

function assertValid(file: string, ok: boolean, errors: unknown): void {
	if (!ok) {
		throw new Error(`schema validation failed for ${file}: ${JSON.stringify(errors, null, 2)}`);
	}
}

describe("propose contract v1 — schema conformance", () => {
	it("golden-propose.json validates against propose-v1.schema.json", () => {
		const envelope = load<ProposeResponse>("golden-propose.json");
		const ok = validatePropose(envelope);
		assertValid("golden-propose.json", ok, validatePropose.errors);
		expect(ok).toBe(true);
	});

	it("status is always 'quarantine'", () => {
		const envelope = load<ProposeResponse>("golden-propose.json");
		expect(envelope.status).toBe("quarantine");
	});

	it("trust_score is within [0, 1]", () => {
		const envelope = load<ProposeResponse>("golden-propose.json");
		expect(envelope.trust_score).toBeGreaterThanOrEqual(0);
		expect(envelope.trust_score).toBeLessThanOrEqual(1);
	});
});

describe("promote contract v1 — schema conformance", () => {
	const cases: Array<{ name: string; file: string; expectRejection: boolean }> = [
		{ name: "validated", file: "golden-promote-validated.json", expectRejection: false },
		{ name: "rejected", file: "golden-promote-rejected.json", expectRejection: true },
	];

	for (const { name, file, expectRejection } of cases) {
		it(`${file} (${name}) validates against promote-v1.schema.json`, () => {
			const envelope = load<PromoteResponse>(file);
			const ok = validatePromote(envelope);
			assertValid(file, ok, validatePromote.errors);
			expect(ok).toBe(true);
			if (expectRejection) {
				expect(envelope.status).toBe("rejected");
				expect(envelope.rejection_reason).toBeDefined();
			} else {
				expect(envelope.status).toBe("validated");
				expect(envelope.rejection_reason).toBeUndefined();
			}
		});
	}

	it("rejection_reason enum includes all 7 known categories", () => {
		const schemaReasons = (
			promoteSchema as {
				properties: { rejection_reason: { enum: string[] } };
			}
		).properties.rejection_reason.enum;
		expect(schemaReasons).toEqual([
			"allowed_target_types",
			"future_scenarios",
			"gate_not_clean",
			"duplicate",
			"evidence_floor",
			"validators",
			"contradictions",
		]);
	});

	it("duplicate rejection carries existing_id", () => {
		const envelope = load<PromoteResponse>("golden-promote-rejected.json");
		if (envelope.rejection_reason === "duplicate") {
			expect(envelope.existing_id).toBeDefined();
			expect(typeof envelope.existing_id).toBe("string");
		}
	});
});

describe("deprecate contract v1 — schema conformance", () => {
	const cases = ["golden-deprecate.json", "golden-deprecate-with-successor.json"];

	for (const file of cases) {
		it(`${file} validates against deprecate-v1.schema.json`, () => {
			const envelope = load<DeprecateResponse>(file);
			const ok = validateDeprecate(envelope);
			assertValid(file, ok, validateDeprecate.errors);
			expect(ok).toBe(true);
		});
	}

	it("status is always 'invalidated'", () => {
		for (const file of cases) {
			expect(load<DeprecateResponse>(file).status).toBe("invalidated");
		}
	});

	it("superseded_by is string or explicit null (never undefined)", () => {
		for (const file of cases) {
			const envelope = load<DeprecateResponse>(file);
			expect(envelope).toHaveProperty("superseded_by");
			const sb = envelope.superseded_by;
			expect(sb === null || typeof sb === "string").toBe(true);
		}
	});

	it("when superseded_by is set, reason mentions it", () => {
		const envelope = load<DeprecateResponse>("golden-deprecate-with-successor.json");
		expect(envelope.superseded_by).toBe("01HTEST00000000000000000099");
		expect(envelope.reason).toContain("superseded_by=01HTEST00000000000000000099");
	});
});

// Type-binding guard — if src/trust/promotion.service.ts removes or renames
// a field, the assignments below fail to compile and the contract drift is
// caught at typecheck time, not just at schema-validation time.
describe("promotion contract — TypeScript ↔ schema drift guard", () => {
	it("ProposeResult instance validates against propose-v1 schema", () => {
		const value: ProposeResult = {
			proposal_id: "01HTEST00000000000000000001",
			status: "quarantine",
			trust_score: 0.6,
		};
		const ok = validatePropose(value);
		assertValid("ProposeResult", ok, validatePropose.errors);
		expect(ok).toBe(true);
	});

	it("PromoteResult validated instance validates against promote-v1 schema", () => {
		const value: PromoteResult = {
			id: "01HTEST00000000000000000001",
			status: "validated",
			trust_score: 0.8,
			reason: "All gate criteria passed",
		};
		const ok = validatePromote(value);
		assertValid("PromoteResult(validated)", ok, validatePromote.errors);
		expect(ok).toBe(true);
	});

	it("PromoteResult rejected with duplicate carries existing_id", () => {
		const value: PromoteResult = {
			id: "01HTEST00000000000000000002",
			status: "rejected",
			trust_score: 0.6,
			reason: "Duplicate of 01HEXISTING000000000000000",
			rejection_reason: "duplicate",
			existing_id: "01HEXISTING000000000000000",
		};
		const ok = validatePromote(value);
		assertValid("PromoteResult(rejected)", ok, validatePromote.errors);
		expect(ok).toBe(true);
	});

	it("DeprecateResult instance validates against deprecate-v1 schema", () => {
		const value: DeprecateResult = {
			id: "01HTEST00000000000000000001",
			status: "invalidated",
			reason: "Superseded",
			superseded_by: null,
		};
		const ok = validateDeprecate(value);
		assertValid("DeprecateResult", ok, validateDeprecate.errors);
		expect(ok).toBe(true);
	});
});
