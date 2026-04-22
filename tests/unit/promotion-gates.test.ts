import { beforeEach, describe, expect, it, vi } from "vitest";
import { PromotionService } from "../../src/trust/promotion.service.js";
import type {
	ImpactLevel,
	MemoryEntry,
	MemoryType,
	PromotionMetadata,
} from "../../src/types.js";

function makeEntry(
	overrides: {
		id?: string;
		type?: MemoryType;
		impactLevel?: ImpactLevel;
		metadata?: PromotionMetadata;
		status?: "quarantine" | "validated";
		files?: string[];
		symbols?: string[];
	} = {},
): MemoryEntry {
	return {
		id: overrides.id ?? "entry_1",
		type: overrides.type ?? "coding_convention",
		title: "t",
		summary: "s",
		details: null,
		scope: {
			repository: "repo-a",
			files: overrides.files ?? ["src/foo.ts"],
			symbols: overrides.symbols ?? ["FooService"],
			modules: [],
		},
		impactLevel: overrides.impactLevel ?? "normal",
		knowledgeClass: "semi_stable",
		consolidationTier: "semantic",
		trust: {
			status: overrides.status ?? "quarantine",
			score: 0.3,
			validatedAt: null,
			expiresAt: new Date("2026-12-01"),
		},
		embeddingText: "e",
		embedding: null,
		accessCount: 0,
		lastAccessedAt: null,
		createdBy: "agent",
		createdInTask: null,
		createdAt: new Date(),
		updatedAt: new Date(),
		promotionMetadata: overrides.metadata ?? {
			futureScenarios: ["a", "b", "c"],
			source: "PR#42",
			gateCleanAtProposal: true,
		},
	};
}

function makeRepo(entry: MemoryEntry, duplicate: MemoryEntry | null = null) {
	return {
		findById: vi.fn().mockResolvedValue(entry),
		findSemanticDuplicate: vi.fn().mockResolvedValue(duplicate),
		transitionStatus: vi.fn().mockResolvedValue(entry),
		updateTrustScore: vi.fn().mockResolvedValue(undefined),
		updatePromotionMetadata: vi.fn().mockResolvedValue(undefined),
		create: vi.fn().mockResolvedValue(entry),
	};
}

function makeQuarantine(decision: "validate" | "reject" = "validate") {
	return {
		validateEntry: vi.fn().mockResolvedValue({
			decision,
			reason:
				decision === "validate"
					? "All validators passed"
					: "Insufficient evidence: 0/1",
			trustScore: decision === "validate" ? 0.8 : 0.1,
		}),
	};
}

const sqlStub = {} as never;

describe("PromotionService — gate criteria", () => {
	beforeEach(() => vi.clearAllMocks());

	describe("gate 1: allowed_target_types", () => {
		it("rejects when entry.type not in allowed list", async () => {
			const entry = makeEntry({ type: "domain_rule" });
			const svc = new PromotionService(
				sqlStub,
				makeRepo(entry) as never,
				makeQuarantine() as never,
			);
			const res = await svc.promote("entry_1", {
				allowedTargetTypes: ["coding_convention", "bug_pattern"],
			});
			expect(res.status).toBe("rejected");
			expect(res.rejection_reason).toBe("allowed_target_types");
			expect(res.reason).toContain("domain_rule");
		});

		it("passes gate when type is in allowed list", async () => {
			const entry = makeEntry({ type: "bug_pattern" });
			const svc = new PromotionService(
				sqlStub,
				makeRepo(entry) as never,
				makeQuarantine() as never,
			);
			const res = await svc.promote("entry_1", {
				allowedTargetTypes: ["bug_pattern"],
			});
			expect(res.status).toBe("validated");
		});

		it("skips gate when allowedTargetTypes is not provided", async () => {
			const entry = makeEntry({ type: "deployment_warning" });
			const svc = new PromotionService(
				sqlStub,
				makeRepo(entry) as never,
				makeQuarantine() as never,
			);
			const res = await svc.promote("entry_1");
			expect(res.status).toBe("validated");
		});
	});

	describe("gate 2: extraction guard (gateCleanAtProposal)", () => {
		it("rejects when gateCleanAtProposal === false", async () => {
			const entry = makeEntry({
				metadata: {
					futureScenarios: ["a", "b", "c"],
					gateCleanAtProposal: false,
				},
			});
			const svc = new PromotionService(
				sqlStub,
				makeRepo(entry) as never,
				makeQuarantine() as never,
			);
			const res = await svc.promote("entry_1");
			expect(res.status).toBe("rejected");
			expect(res.rejection_reason).toBe("gate_not_clean");
		});

		it("passes gate when gateCleanAtProposal is true or undefined", async () => {
			const entry = makeEntry({
				metadata: { futureScenarios: ["a", "b", "c"] }, // undefined → not blocked
			});
			const svc = new PromotionService(
				sqlStub,
				makeRepo(entry) as never,
				makeQuarantine() as never,
			);
			const res = await svc.promote("entry_1");
			expect(res.status).toBe("validated");
		});
	});

	describe("gate 3: 3-future-decisions heuristic", () => {
		it("rejects when fewer than 3 non-empty scenarios provided", async () => {
			const entry = makeEntry({
				impactLevel: "normal",
				metadata: { futureScenarios: ["a", "b"], gateCleanAtProposal: true },
			});
			const svc = new PromotionService(
				sqlStub,
				makeRepo(entry) as never,
				makeQuarantine() as never,
			);
			const res = await svc.promote("entry_1");
			expect(res.status).toBe("rejected");
			expect(res.rejection_reason).toBe("future_scenarios");
			expect(res.reason).toContain("got 2");
		});

		it("ignores blank-string scenarios when counting", async () => {
			const entry = makeEntry({
				impactLevel: "high",
				metadata: {
					futureScenarios: ["a", "  ", "", "b"],
					gateCleanAtProposal: true,
				},
			});
			const svc = new PromotionService(
				sqlStub,
				makeRepo(entry) as never,
				makeQuarantine() as never,
			);
			const res = await svc.promote("entry_1");
			expect(res.status).toBe("rejected");
			expect(res.rejection_reason).toBe("future_scenarios");
		});

		it("skips gate entirely for low-impact entries", async () => {
			const entry = makeEntry({
				impactLevel: "low",
				metadata: { futureScenarios: [], gateCleanAtProposal: true },
			});
			const svc = new PromotionService(
				sqlStub,
				makeRepo(entry) as never,
				makeQuarantine() as never,
			);
			const res = await svc.promote("entry_1");
			expect(res.status).toBe("validated");
		});

		it("passes when exactly 3 non-empty scenarios present", async () => {
			const entry = makeEntry({
				impactLevel: "critical",
				metadata: {
					futureScenarios: ["x", "y", "z"],
					gateCleanAtProposal: true,
				},
			});
			const svc = new PromotionService(
				sqlStub,
				makeRepo(entry) as never,
				makeQuarantine() as never,
			);
			const res = await svc.promote("entry_1");
			expect(res.status).toBe("validated");
		});
	});

	describe("gate 4: non-duplication", () => {
		it("rejects when a validated sibling with overlapping scope exists", async () => {
			const candidate = makeEntry();
			const sibling = makeEntry({
				id: "entry_existing",
				status: "validated",
			});
			const svc = new PromotionService(
				sqlStub,
				makeRepo(candidate, sibling) as never,
				makeQuarantine() as never,
			);
			const res = await svc.promote("entry_1");
			expect(res.status).toBe("rejected");
			expect(res.rejection_reason).toBe("duplicate");
			expect(res.existing_id).toBe("entry_existing");
		});

		it("allows promotion when skipDuplicateCheck is true", async () => {
			const candidate = makeEntry();
			const sibling = makeEntry({ id: "entry_existing", status: "validated" });
			const repo = makeRepo(candidate, sibling);
			const svc = new PromotionService(
				sqlStub,
				repo as never,
				makeQuarantine() as never,
			);
			const res = await svc.promote("entry_1", { skipDuplicateCheck: true });
			expect(res.status).toBe("validated");
			expect(repo.findSemanticDuplicate).not.toHaveBeenCalled();
		});
	});

	describe("quarantine delegation (gate 5+)", () => {
		it("classifies insufficient evidence as evidence_floor", async () => {
			const entry = makeEntry();
			const svc = new PromotionService(
				sqlStub,
				makeRepo(entry) as never,
				makeQuarantine("reject") as never,
			);
			const res = await svc.promote("entry_1");
			expect(res.status).toBe("rejected");
			expect(res.rejection_reason).toBe("evidence_floor");
		});
	});

	describe("legacy call signature", () => {
		it("accepts a string triggeredBy as second argument (back-compat)", async () => {
			const entry = makeEntry();
			const svc = new PromotionService(
				sqlStub,
				makeRepo(entry) as never,
				makeQuarantine() as never,
			);
			const res = await svc.promote("entry_1", "human:alice");
			expect(res.status).toBe("validated");
		});
	});
});
