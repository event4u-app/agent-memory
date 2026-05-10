import { describe, expect, it } from "vitest";
import {
	auditEntry,
	planArchiveTransitions,
	planRedactPatch,
} from "../../src/security/secret-audit.js";
import { SECRET_AUDIT_MARKER } from "../../src/security/secret-guard.js";
import type { MemoryEntry } from "../../src/types.js";

// Runtime-assembled canary — same technique as tests/e2e/canaries.ts. Keeps
// the literal off the at-rest push-protection scanners while still matching
// the github_token regex at runtime.
const s = (...parts: string[]): string => parts.join("");
const GITHUB_CANARY = s("ghp", "_agentmemoryaudit0123456789ABCDEFGHIJ");
const AWS_CANARY = s("AK", "IAAGENTMEMORYAUDIT1");

function makeEntry(overrides: Partial<MemoryEntry> & { id: string }): MemoryEntry {
	return {
		id: overrides.id,
		type: "coding_convention",
		title: "Test entry",
		summary: "Test summary",
		details: null,
		scope: { repository: "test", files: [], symbols: [], modules: [] },
		impactLevel: "normal",
		knowledgeClass: "semi_stable",
		consolidationTier: "semantic",
		trust: {
			status: "validated",
			score: 0.8,
			validatedAt: new Date("2026-01-01"),
			expiresAt: new Date("2026-02-01"),
		},
		embeddingText: "test",
		embedding: null,
		accessCount: 0,
		lastAccessedAt: null,
		createdBy: "agent",
		createdInTask: null,
		createdAt: new Date("2026-01-01"),
		updatedAt: new Date("2026-01-01"),
		...overrides,
	};
}

describe("auditEntry", () => {
	it("returns null for a clean entry", () => {
		expect(auditEntry(makeEntry({ id: "e-clean" }))).toBeNull();
	});

	it("reports a single pattern match with provider + confidence", () => {
		const finding = auditEntry(
			makeEntry({ id: "e-gh", details: `use token ${GITHUB_CANARY} in CI` }),
		);
		expect(finding).not.toBeNull();
		expect(finding?.id).toBe("e-gh");
		expect(finding?.status).toBe("validated");
		expect(finding?.findings).toHaveLength(1);
		const hit = finding?.findings[0];
		expect(hit?.pattern).toBe("github_token");
		expect(hit?.provider).toBe("github");
		expect(hit?.confidence).toBe("high");
		expect(hit?.fields).toEqual(["details"]);
		expect(hit?.count).toBe(1);
	});

	it("aggregates the same pattern across multiple fields", () => {
		const finding = auditEntry(
			makeEntry({
				id: "e-multi",
				title: `prefix ${AWS_CANARY}`,
				summary: `also in summary ${AWS_CANARY}`,
				embeddingText: `and here ${AWS_CANARY}`,
			}),
		);
		const hit = finding?.findings[0];
		expect(hit?.pattern).toBe("aws_access_key");
		expect(hit?.fields).toEqual(["embeddingText", "summary", "title"]);
		expect(hit?.count).toBe(3);
	});

	it("reports cleartext nowhere in the finding", () => {
		const finding = auditEntry(
			makeEntry({ id: "e-secret", summary: `key=${GITHUB_CANARY} embedded` }),
		);
		const serialized = JSON.stringify(finding);
		expect(serialized).not.toContain(GITHUB_CANARY);
	});

	it("does not fire on high-entropy-only content (III2-equivalent scope)", () => {
		// A 40-char hex blob is high-entropy but has no SECRET_DETECTED pattern.
		// III1 deliberately mirrors III2 and does not act on entropy alone.
		const hex = "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2";
		expect(auditEntry(makeEntry({ id: "e-hex", details: `hash=${hex}` }))).toBeNull();
	});
});

describe("planRedactPatch", () => {
	it("returns null for a clean entry", () => {
		expect(planRedactPatch(makeEntry({ id: "e-clean" }))).toBeNull();
	});

	it("rewrites only fields that matched and reports patternsHit", () => {
		const patch = planRedactPatch(
			makeEntry({
				id: "e-rw",
				title: "Benign title",
				details: `hardcoded ${GITHUB_CANARY}`,
				embeddingText: `vector-input ${GITHUB_CANARY}`,
			}),
		);
		expect(patch).not.toBeNull();
		expect(patch?.title).toBeUndefined();
		expect(patch?.summary).toBeUndefined();
		expect(patch?.details).toBe(`hardcoded ${SECRET_AUDIT_MARKER}`);
		expect(patch?.embeddingText).toBe(`vector-input ${SECRET_AUDIT_MARKER}`);
		expect(patch?.patternsHit).toEqual(["github_token"]);
	});
});

describe("planArchiveTransitions", () => {
	it("no-op for already-archived", () => {
		expect(planArchiveTransitions("archived")).toEqual([]);
	});

	it("direct one-step for validated", () => {
		expect(planArchiveTransitions("validated")).toEqual([{ from: "validated", to: "archived" }]);
	});

	it("two-phase for quarantine: quarantine → rejected → archived", () => {
		expect(planArchiveTransitions("quarantine")).toEqual([
			{ from: "quarantine", to: "rejected" },
			{ from: "rejected", to: "archived" },
		]);
	});

	it("single-step for every other live status", () => {
		for (const from of ["stale", "invalidated", "rejected", "poisoned"] as const) {
			const plan = planArchiveTransitions(from);
			expect(plan[plan.length - 1]?.to).toBe("archived");
		}
	});
});
