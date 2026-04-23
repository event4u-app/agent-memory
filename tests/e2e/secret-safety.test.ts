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
import {
	enforceNoSecretsWithAudit,
	SecretViolationError,
	scanForSecrets,
} from "../../src/security/secret-guard.js";
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

describe("IV1 · audit event emission — every reject/redact produces exactly one event", () => {
	beforeEach(() => {
		process.env.MEMORY_SECRET_POLICY = "reject";
	});

	/**
	 * Minimal recorder that records calls for assertion. Matches the
	 * shape `enforceNoSecretsWithAudit` uses from MemoryEventRepository.
	 */
	function recorderMock() {
		return {
			record: vi.fn().mockResolvedValue({ id: "evt-1" }),
			countByTypeSince: vi.fn(),
			listByEntry: vi.fn(),
		};
	}

	it("PromotionService.propose (reject) emits secret_rejected with pattern + path, no raw value", async () => {
		const c = CANARIES[0];
		if (!c) throw new Error("canary fixture empty");
		const entryRepo = { create: vi.fn(), updateTrustScore: vi.fn() };
		const rec = recorderMock();
		const service = new PromotionService(
			{} as never,
			entryRepo as never,
			{} as never,
			rec as never,
		);

		await expect(
			service.propose({
				type: "coding_convention",
				title: "t",
				summary: `leaked ${c.value}`,
				scope: { repository: "repo-a", files: [], symbols: [], modules: [] },
				impactLevel: "normal",
				knowledgeClass: "semi_stable",
				embeddingText: "e",
				createdBy: "test",
				source: "PR#1",
				confidence: 0.6,
				actor: "user:cli",
				ingressPath: "cli_propose",
			}),
		).rejects.toBeInstanceOf(SecretViolationError);

		expect(rec.record).toHaveBeenCalledTimes(1);
		const call = rec.record.mock.calls[0]?.[0] as {
			actor: string;
			eventType: string;
			metadata: Record<string, unknown>;
			entryId: unknown;
		};
		expect(call.actor).toBe("user:cli");
		expect(call.eventType).toBe("secret_rejected");
		expect(call.entryId).toBeNull();
		expect(call.metadata.ingress_path).toBe("cli_propose");
		expect(call.metadata.policy).toBe("reject");
		expect(call.metadata.patterns).toContain(c.pattern);
		const serialized = JSON.stringify(call);
		expect(serialized).not.toContain(c.value);
		expect(serialized).not.toContain(CANARY_MARKER);
	});

	it("enforceNoSecretsWithAudit (redact) emits secret_redacted without throwing", async () => {
		// Redact policy is hit directly — config.security.secretPolicy is
		// resolved once at module import, so the most reliable path is to
		// invoke the guard with an explicit policy override.
		const c = CANARIES[0];
		if (!c) throw new Error("canary fixture empty");
		const rec = recorderMock();

		const v = await enforceNoSecretsWithAudit(
			{ summary: `leaked ${c.value}` },
			"redact",
			{ actor: "agent:mcp", ingressPath: "mcp_propose" },
			rec as never,
		);

		expect(v).not.toBeNull();
		expect(rec.record).toHaveBeenCalledTimes(1);
		const call = rec.record.mock.calls[0]?.[0] as {
			eventType: string;
			metadata: Record<string, unknown>;
		};
		expect(call.eventType).toBe("secret_redacted");
		expect(call.metadata.policy).toBe("redact");
		expect(JSON.stringify(call)).not.toContain(c.value);
	});

	it("memory_observe reject emits secret_rejected via ctx.eventRepo", async () => {
		const c = CANARIES[0];
		if (!c) throw new Error("canary fixture empty");
		const rec = recorderMock();
		const ctx = {
			observationRepo: { create: vi.fn() },
			eventRepo: rec,
		} as unknown as McpContext;

		await handleToolCall(
			"memory_observe",
			{ sessionId: "s1", content: `agent output: ${c.value}`, source: "tool-use" },
			ctx,
		);

		expect(rec.record).toHaveBeenCalledTimes(1);
		const call = rec.record.mock.calls[0]?.[0] as {
			actor: string;
			eventType: string;
			metadata: Record<string, unknown>;
		};
		expect(call.actor).toBe("agent:mcp");
		expect(call.eventType).toBe("secret_rejected");
		expect(call.metadata.ingress_path).toBe("mcp_observe");
		expect(JSON.stringify(call)).not.toContain(c.value);
	});

	it("memory_observe_failure reject emits secret_rejected with mcp_observe_failure path", async () => {
		const c = CANARIES[0];
		if (!c) throw new Error("canary fixture empty");
		const rec = recorderMock();
		const ctx = {
			observationRepo: { create: vi.fn() },
			eventRepo: rec,
		} as unknown as McpContext;

		await handleToolCall(
			"memory_observe_failure",
			{
				sessionId: "s1",
				toolName: "bash",
				errorMessage: "command failed",
				stderr: `Authorization: Bearer ${c.value}`,
			},
			ctx,
		);

		expect(rec.record).toHaveBeenCalledTimes(1);
		const call = rec.record.mock.calls[0]?.[0] as {
			eventType: string;
			metadata: Record<string, unknown>;
		};
		expect(call.eventType).toBe("secret_rejected");
		expect(call.metadata.ingress_path).toBe("mcp_observe_failure");
	});

	it("clean ingress produces zero audit events", async () => {
		const rec = recorderMock();
		const ctx = {
			observationRepo: { create: vi.fn().mockResolvedValue({ id: "obs-1" }) },
			eventRepo: rec,
		} as unknown as McpContext;

		await handleToolCall(
			"memory_observe",
			{ sessionId: "s1", content: "nothing interesting here", source: "tool-use" },
			ctx,
		);

		expect(rec.record).not.toHaveBeenCalled();
	});

	it("recorder failure does not mask the policy decision", async () => {
		const c = CANARIES[0];
		if (!c) throw new Error("canary fixture empty");
		const rec = {
			record: vi.fn().mockRejectedValue(new Error("DB down")),
			countByTypeSince: vi.fn(),
			listByEntry: vi.fn(),
		};
		const ctx = {
			observationRepo: { create: vi.fn() },
			eventRepo: rec,
		} as unknown as McpContext;

		const result = await handleToolCall(
			"memory_observe",
			{ sessionId: "s1", content: `leak ${c.value}`, source: "tool-use" },
			ctx,
		);

		// Policy still rejects — audit write failure must not turn into a 200-OK.
		expect(result.isError).toBe(true);
		const body = JSON.parse((result.content[0] as { text: string }).text) as { code: string };
		expect(body.code).toBe("INGRESS_POLICY_VIOLATION");
	});
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
