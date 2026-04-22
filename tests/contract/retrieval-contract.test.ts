import { readFileSync } from "node:fs";
import { join } from "node:path";
import Ajv from "ajv";
import addFormats from "ajv-formats";
import { describe, expect, it } from "vitest";

const FIXTURE_DIR = join(process.cwd(), "tests/fixtures/retrieval");

function load<T = unknown>(file: string): T {
	return JSON.parse(readFileSync(join(FIXTURE_DIR, file), "utf-8")) as T;
}

const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);

const retrievalSchema = load("retrieval-v1.schema.json");
const healthSchema = load("health-v1.schema.json");
const validateRetrieval = ajv.compile(retrievalSchema);
const validateHealth = ajv.compile(healthSchema);

interface Envelope {
	contract_version: number;
	status: "ok" | "partial" | "error";
	entries: Array<{ id: string; type: string }>;
	slices: Record<string, { status: string; count: number }>;
	errors: Array<{ type: string; code: string; message: string }>;
}

describe("retrieval contract v1 — schema conformance", () => {
	const cases: Array<{ name: string; file: string }> = [
		{ name: "status=ok", file: "golden-ok.json" },
		{ name: "status=partial", file: "golden-partial.json" },
		{ name: "status=error", file: "golden-error.json" },
	];

	for (const { name, file } of cases) {
		it(`${file} (${name}) validates against retrieval-v1.schema.json`, () => {
			const envelope = load<Envelope>(file);
			const ok = validateRetrieval(envelope);
			if (!ok) {
				throw new Error(
					`schema validation failed for ${file}: ${JSON.stringify(validateRetrieval.errors, null, 2)}`,
				);
			}
			expect(ok).toBe(true);
		});
	}
});

describe("retrieval contract v1 — semantic invariants", () => {
	it("golden-ok: every slice status is ok", () => {
		const envelope = load<Envelope>("golden-ok.json");
		expect(envelope.status).toBe("ok");
		for (const slice of Object.values(envelope.slices)) {
			expect(slice.status).toBe("ok");
		}
		expect(envelope.errors).toEqual([]);
	});

	it("golden-partial: at least one slice non-ok AND entries non-empty", () => {
		const envelope = load<Envelope>("golden-partial.json");
		expect(envelope.status).toBe("partial");
		const sliceStatuses = Object.values(envelope.slices).map((s) => s.status);
		expect(sliceStatuses).toContain("timeout");
		expect(sliceStatuses).toContain("ok");
		expect(envelope.entries.length).toBeGreaterThan(0);
		expect(envelope.errors.length).toBeGreaterThan(0);
	});

	it("golden-error: entries MUST be empty", () => {
		const envelope = load<Envelope>("golden-error.json");
		expect(envelope.status).toBe("error");
		expect(envelope.entries).toEqual([]);
		for (const slice of Object.values(envelope.slices)) {
			expect(slice.status).not.toBe("ok");
		}
	});

	it("slice counts match the number of entries of that type", () => {
		for (const file of ["golden-ok.json", "golden-partial.json"]) {
			const envelope = load<Envelope>(file);
			const entryCounts = new Map<string, number>();
			for (const entry of envelope.entries) {
				entryCounts.set(entry.type, (entryCounts.get(entry.type) ?? 0) + 1);
			}
			for (const [type, slice] of Object.entries(envelope.slices)) {
				if (slice.status === "ok") {
					expect(slice.count, `${file}: slice count for ${type}`).toBe(entryCounts.get(type) ?? 0);
				}
			}
		}
	});

	it("contract_version is always 1", () => {
		for (const file of ["golden-ok.json", "golden-partial.json", "golden-error.json"]) {
			expect(load<Envelope>(file).contract_version).toBe(1);
		}
	});
});

describe("health contract v1 — schema conformance", () => {
	const cases = ["golden-health-ok.json", "golden-health-error.json"];
	for (const file of cases) {
		it(`${file} validates against health-v1.schema.json`, () => {
			const envelope = load(file);
			const ok = validateHealth(envelope);
			if (!ok) {
				throw new Error(
					`schema validation failed for ${file}: ${JSON.stringify(validateHealth.errors, null, 2)}`,
				);
			}
			expect(ok).toBe(true);
		});
	}

	it("features list is non-empty for ok status", () => {
		const envelope = load<{ features: string[] }>("golden-health-ok.json");
		expect(envelope.features.length).toBeGreaterThan(0);
	});
});
