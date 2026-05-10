import { beforeEach, describe, expect, it, vi } from "vitest";
import type { McpContext } from "../../src/mcp/context.js";
import { handleToolCall } from "../../src/mcp/tool-handlers.js";
import { SecretViolationError } from "../../src/security/secret-guard.js";
import { createSecretViolation } from "../../src/security/secret-violation.js";
import { PromotionService } from "../../src/trust/promotion.service.js";

const ORIGINAL_POLICY = process.env.MEMORY_SECRET_POLICY;

describe("secret-guard wiring — PromotionService.propose", () => {
	beforeEach(() => {
		process.env.MEMORY_SECRET_POLICY = "reject";
	});

	it("throws SecretViolationError and never calls the repo under reject policy", async () => {
		const entryRepo = {
			create: vi.fn(),
			updateTrustScore: vi.fn(),
		};
		const service = new PromotionService({} as never, entryRepo as never, {} as never);

		await expect(
			service.propose({
				type: "coding_convention",
				title: "Use this token",
				summary: "ghp_0123456789abcdefghijklmnopqrstuvwxyz01",
				scope: { repository: "repo-a", files: [], symbols: [], modules: [] },
				impactLevel: "normal",
				knowledgeClass: "semi_stable",
				embeddingText: "irrelevant",
				createdBy: "test",
				source: "PR#1",
				confidence: 0.6,
			}),
		).rejects.toBeInstanceOf(SecretViolationError);

		expect(entryRepo.create).not.toHaveBeenCalled();
		expect(entryRepo.updateTrustScore).not.toHaveBeenCalled();
	});
});

describe("secret-guard wiring — MCP handlePropose", () => {
	beforeEach(() => {
		process.env.MEMORY_SECRET_POLICY = ORIGINAL_POLICY ?? "";
		if (!process.env.MEMORY_SECRET_POLICY) delete process.env.MEMORY_SECRET_POLICY;
	});

	it("returns a structured INGRESS_POLICY_VIOLATION CallToolResult when service throws", async () => {
		const violation = createSecretViolation(
			[{ code: "SECRET_DETECTED", pattern: "github_token", field: "summary" }],
			"reject",
		);
		const ctx = {
			promotionService: {
				propose: vi.fn().mockRejectedValue(new SecretViolationError(violation)),
			},
		} as unknown as McpContext;

		const result = await handleToolCall(
			"memory_propose",
			{
				type: "coding_convention",
				title: "t",
				summary: "s",
				scope: { repository: "repo-a" },
				impactLevel: "normal",
				knowledgeClass: "semi_stable",
				embeddingText: "e",
				source: "PR#1",
				confidence: 0.6,
			},
			ctx,
		);

		expect(result.isError).toBe(true);
		const body = JSON.parse((result.content[0] as { text: string }).text) as {
			code: string;
			detections: { pattern: string }[];
		};
		expect(body.code).toBe("INGRESS_POLICY_VIOLATION");
		expect(body.detections[0]?.pattern).toBe("github_token");
	});

	it("propagates non-secret errors through the normal error path", async () => {
		const ctx = {
			promotionService: {
				propose: vi.fn().mockRejectedValue(new Error("db offline")),
			},
		} as unknown as McpContext;

		await expect(
			handleToolCall(
				"memory_propose",
				{
					type: "coding_convention",
					title: "t",
					summary: "s",
					scope: { repository: "repo-a" },
					impactLevel: "normal",
					knowledgeClass: "semi_stable",
					embeddingText: "e",
					source: "PR#1",
					confidence: 0.6,
				},
				ctx,
			),
		).rejects.toThrow("db offline");
	});
});
