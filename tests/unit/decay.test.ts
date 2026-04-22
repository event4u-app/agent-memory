import { describe, expect, it } from "vitest";
import {
	applyDecay,
	DEFAULT_DECAY_CONFIG,
	mergeDecayConfig,
	resolveDecayRule,
	shouldRefreshOnHit,
} from "../../src/trust/decay.js";

describe("decay — resolveDecayRule", () => {
	it("falls back to tier defaults when no override", () => {
		const rule = resolveDecayRule("semantic", "unknown_type");
		expect(rule.halfLifeDays).toBe(180);
		expect(rule.floor).toBe(0.3);
	});

	it("applies type overrides on top of tier defaults", () => {
		const rule = resolveDecayRule("semantic", "domain-invariant");
		expect(rule.halfLifeDays).toBe(365);
		expect(rule.floor).toBe(0.3);
	});

	it("treats halfLifeDays:null (ADR) as no-decay", () => {
		const rule = resolveDecayRule("semantic", "adr");
		expect(rule.halfLifeDays).toBeNull();
	});

	it("maps internal MemoryType values to overrides", () => {
		const rule = resolveDecayRule("semantic", "architecture_decision");
		expect(rule.halfLifeDays).toBeNull();
	});

	it("applies partial overrides (floor only)", () => {
		const rule = resolveDecayRule("semantic", "historical-pattern");
		expect(rule.halfLifeDays).toBe(180);
		expect(rule.floor).toBe(0.5);
	});
});

describe("decay — applyDecay", () => {
	it("skips decay when halfLifeDays is null", () => {
		const out = applyDecay(0.9, 1000, { halfLifeDays: null, floor: 0 });
		expect(out).toBe(0.9);
	});

	it("halves score after one half-life", () => {
		const out = applyDecay(0.8, 30, { halfLifeDays: 30, floor: 0 });
		expect(out).toBeCloseTo(0.4, 5);
	});

	it("clamps to floor", () => {
		const out = applyDecay(0.9, 10_000, { halfLifeDays: 30, floor: 0.3 });
		expect(out).toBe(0.3);
	});

	it("returns base score for zero or negative age", () => {
		const out = applyDecay(0.7, 0, { halfLifeDays: 30, floor: 0 });
		expect(out).toBe(0.7);
	});
});

describe("decay — shouldRefreshOnHit", () => {
	it("blocks refresh within cooldown", () => {
		const now = new Date("2026-01-10T00:00:00Z");
		const last = new Date("2026-01-07T00:00:00Z"); // 3d ago
		expect(shouldRefreshOnHit(last, now)).toBe(false);
	});

	it("allows refresh after cooldown", () => {
		const now = new Date("2026-01-10T00:00:00Z");
		const last = new Date("2026-01-01T00:00:00Z"); // 9d ago
		expect(shouldRefreshOnHit(last, now)).toBe(true);
	});
});

describe("decay — mergeDecayConfig", () => {
	it("returns base when overrides undefined", () => {
		expect(mergeDecayConfig(undefined)).toBe(DEFAULT_DECAY_CONFIG);
	});

	it("merges tier defaults additively", () => {
		const merged = mergeDecayConfig({
			tierDefaults: {
				semantic: { halfLifeDays: 200, floor: 0.4 },
			} as never,
		});
		expect(merged.tierDefaults.semantic.halfLifeDays).toBe(200);
		expect(merged.tierDefaults.semantic.floor).toBe(0.4);
		// Other tiers untouched
		expect(merged.tierDefaults.episodic.halfLifeDays).toBe(30);
	});

	it("adds consumer-defined type overrides", () => {
		const merged = mergeDecayConfig({
			typeOverrides: {
				"custom-type": { halfLifeDays: 42 },
			},
		});
		expect(merged.typeOverrides["custom-type"].halfLifeDays).toBe(42);
		// Spec defaults preserved
		expect(merged.typeOverrides.adr.halfLifeDays).toBeNull();
	});
});
