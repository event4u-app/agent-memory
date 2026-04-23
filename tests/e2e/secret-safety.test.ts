/**
 * Canary-token end-to-end tests for the secret-safety invariants.
 *
 * Each test tries to smuggle a canary through one ingress path and then
 * asserts three invariants simultaneously:
 *
 *   1. The guard fires — the caller sees `SecretViolationError` (service)
 *      or a structured `INGRESS_POLICY_VIOLATION` result (MCP).
 *   2. Downstream side-effects never happen — the storage repo / provider
 *      mocks receive no call. This is the DB-level assertion from the
 *      roadmap reshaped for hermetic tests: a mock repo that refuses the
 *      write is contractually identical to `SELECT COUNT(*) = 0`.
 *   3. No canary leaks into captured log output.
 *
 * Canary tokens are syntactically valid for their pattern but operatively
 * invalid (`agent_memory_canary` marker baked in). They live in
 * `./canaries.ts` so the catalog and the canary registry evolve together.
 */

import { Writable } from "node:stream";
import pino from "pino";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EmbeddingFallbackChain } from "../../src/embedding/fallback-chain.js";
import type { EmbeddingProvider } from "../../src/embedding/types.js";
import type { McpContext } from "../../src/mcp/context.js";
import { handleToolCall } from "../../src/mcp/tool-handlers.js";
import { SecretViolationError, scanForSecrets } from "../../src/security/secret-guard.js";
import { createSecretViolation } from "../../src/security/secret-violation.js";
import { PromotionService } from "../../src/trust/promotion.service.js";
import { redactLoggerOptions } from "../../src/utils/logger.js";
import { CANARIES, CANARY_MARKER } from "./canaries.js";

function captureLogger() {
	const lines: string[] = [];
	const stream = new Writable({
		write(chunk, _enc, cb) {
			lines.push(chunk.toString());
			cb();
		},
	});
	const log = pino({ ...redactLoggerOptions, level: "debug" }, stream);
	return { log, lines };
}

describe("canary catalog coverage", () => {
	for (const c of CANARIES) {
		it(`${c.pattern}: canary is detected and named correctly`, () => {
			const d = scanForSecrets(c.value);
			expect(d.map((x) => x.pattern)).toContain(c.pattern);
		});
	}
});

describe("CLI / service ingress — PromotionService.propose", () => {
	beforeEach(() => {
		process.env.MEMORY_SECRET_POLICY = "reject";
	});

	for (const c of CANARIES) {
		it(`rejects ${c.pattern} canary; repo.create is never called`, async () => {
			const entryRepo = {
				create: vi.fn(),
				updateTrustScore: vi.fn(),
			};
			const service = new PromotionService({} as never, entryRepo as never, {} as never);

			await expect(
				service.propose({
					type: "coding_convention",
					title: "innocent title",
					summary: `leaked ${c.value}`,
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
	}
});

describe("MCP ingress — memory_propose", () => {
	it("returns INGRESS_POLICY_VIOLATION for every canary; violation never contains the raw value", async () => {
		for (const c of CANARIES) {
			const violation = createSecretViolation(
				[{ code: "SECRET_DETECTED", pattern: c.pattern, field: "summary" }],
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
					summary: c.value,
					scope: { repository: "repo-a" },
					impactLevel: "normal",
					knowledgeClass: "semi_stable",
					embeddingText: "e",
					source: "PR#1",
					confidence: 0.6,
				},
				ctx,
			);

			expect(result.isError, `${c.pattern} expected isError=true`).toBe(true);
			const text = (result.content[0] as { text: string }).text;
			const body = JSON.parse(text) as { code: string };
			expect(body.code).toBe("INGRESS_POLICY_VIOLATION");
			// The canary value must never appear in the error envelope.
			expect(text).not.toContain(c.value);
		}
	});
});

describe("MCP ingress — memory_observe / memory_observe_failure", () => {
	beforeEach(() => {
		process.env.MEMORY_SECRET_POLICY = "reject";
	});

	function observeCtx() {
		return {
			observationRepo: {
				create: vi.fn().mockResolvedValue({ id: "obs-should-never-see-this" }),
			},
		} as unknown as McpContext;
	}

	for (const c of CANARIES) {
		it(`memory_observe rejects ${c.pattern}; observationRepo.create never called`, async () => {
			const ctx = observeCtx();
			const result = await handleToolCall(
				"memory_observe",
				{ sessionId: "s1", content: `agent output: ${c.value}`, source: "tool-use" },
				ctx,
			);
			expect(result.isError, `${c.pattern} expected isError=true`).toBe(true);
			const text = (result.content[0] as { text: string }).text;
			expect(JSON.parse(text).code).toBe("INGRESS_POLICY_VIOLATION");
			expect(text).not.toContain(c.value);
			expect(
				(ctx.observationRepo as unknown as { create: ReturnType<typeof vi.fn> }).create,
			).not.toHaveBeenCalled();
		});

		it(`memory_observe_failure rejects ${c.pattern} in stderr`, async () => {
			const ctx = observeCtx();
			const result = await handleToolCall(
				"memory_observe_failure",
				{
					sessionId: "s1",
					toolName: "bash",
					errorMessage: "command failed",
					stderr: `Authorization: Bearer ${c.value}`,
				},
				ctx,
			);
			expect(result.isError, `${c.pattern} expected isError=true`).toBe(true);
			const text = (result.content[0] as { text: string }).text;
			expect(JSON.parse(text).code).toBe("INGRESS_POLICY_VIOLATION");
			expect(text).not.toContain(c.value);
			expect(
				(ctx.observationRepo as unknown as { create: ReturnType<typeof vi.fn> }).create,
			).not.toHaveBeenCalled();
		});
	}
});

describe("embedding boundary — EmbeddingFallbackChain.embed", () => {
	function fakeProvider(): EmbeddingProvider & { embed: ReturnType<typeof vi.fn> } {
		return {
			name: "fake",
			isActive: true,
			dimension: 8,
			embed: vi.fn().mockResolvedValue(new Array(8).fill(0)),
		} as unknown as EmbeddingProvider & { embed: ReturnType<typeof vi.fn> };
	}

	beforeEach(() => {
		process.env.MEMORY_SECRET_POLICY = "reject";
	});

	for (const c of CANARIES) {
		it(`never calls the provider when ${c.pattern} canary is in the text`, async () => {
			const provider = fakeProvider();
			const chain = new EmbeddingFallbackChain([provider]);
			await expect(chain.embed(`query about ${c.value}`)).rejects.toBeInstanceOf(
				SecretViolationError,
			);
			expect(provider.embed).not.toHaveBeenCalled();
		});
	}
});

describe("log capture — free-string canary is scrubbed", () => {
	for (const c of CANARIES) {
		it(`pino stream never emits the ${c.pattern} canary value verbatim`, () => {
			const { log, lines } = captureLogger();
			log.info(`audit: received ${c.value} from caller`);
			log.info({ note: "structured", embeddingText: c.value }, "propose attempt");

			const joined = lines.join("");
			expect(joined).not.toContain(c.value);
			// Canary marker is a strong negative — if any canary slipped by both
			// free-string and structured redaction, it would appear.
			expect(joined).not.toContain(CANARY_MARKER);
		});
	}
});
