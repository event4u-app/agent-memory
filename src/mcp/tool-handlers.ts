import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { config } from "../config.js";
import { WorkingToEpisodicConsolidator } from "../consolidation/working-to-episodic.js";
import { healthCheck } from "../db/connection.js";
import { ExtractionGuard } from "../ingestion/extraction-guard.js";
import { applyPrivacyFilter } from "../ingestion/privacy-filter.js";
import { hardInvalidate, softInvalidate } from "../invalidation/invalidation-flows.js";
import { RollbackService } from "../invalidation/rollback.js";
import {
	listUnresolved,
	type ResolutionStrategy,
	resolveContradiction,
} from "../quality/contradiction-resolution.js";
import { findDuplicates, mergeDuplicates } from "../quality/dedup.js";
import { calculateMetrics } from "../quality/metrics.js";
import {
	BACKEND_FEATURES,
	CONTRACT_VERSION,
	computeEnvelopeStatus,
	type HealthResponseV1,
	type RetrieveResponseV1,
	type SliceSummary,
	toContractEntry,
} from "../retrieval/contract.js";
import type { DisclosureLevel } from "../retrieval/progressive-disclosure.js";
import {
	type RetrievalWarning,
	redactDetailEntry,
	redactEntriesForRetrieval,
} from "../security/retrieval-redaction.js";
import { enforceNoSecrets, SecretViolationError } from "../security/secret-guard.js";
import type { SecretViolation } from "../security/secret-violation.js";
import type { ImpactLevel, KnowledgeClass, MemoryType } from "../types.js";
import type { McpContext } from "./context.js";

function ok(data: unknown): CallToolResult {
	return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}

function err(message: string): CallToolResult {
	return {
		content: [{ type: "text", text: JSON.stringify({ error: message }) }],
		isError: true,
	};
}

/**
 * Structured ingress-policy error surface. MCP clients key off `code =
 * INGRESS_POLICY_VIOLATION` and parse the violation body to rephrase input.
 */
function secretViolationResult(violation: SecretViolation): CallToolResult {
	return {
		content: [{ type: "text", text: JSON.stringify(violation, null, 2) }],
		isError: true,
	};
}

type Args = Record<string, unknown>;

const LEVEL_MAP: Record<string, DisclosureLevel> = {
	L1: "index",
	L2: "timeline",
	L3: "full",
};

export async function handleToolCall(
	name: string,
	args: Args,
	ctx: McpContext,
): Promise<CallToolResult> {
	try {
		return await dispatchTool(name, args, ctx);
	} catch (error) {
		// Top-level ingress-policy catch — any handler that invokes
		// `enforceNoSecrets` (propose, observe, observe_failure, future ingress
		// paths) surfaces as a structured INGRESS_POLICY_VIOLATION result
		// without leaking the raw value. Other errors propagate unchanged.
		if (error instanceof SecretViolationError) {
			return secretViolationResult(error.violation);
		}
		throw error;
	}
}

async function dispatchTool(name: string, args: Args, ctx: McpContext): Promise<CallToolResult> {
	switch (name) {
		case "memory_retrieve":
			return handleRetrieve(args, ctx);
		case "memory_retrieve_details":
			return handleRetrieveDetails(args, ctx);
		case "memory_ingest":
			return handleIngest(args, ctx);
		case "memory_validate":
			return handleValidate(args, ctx);
		case "memory_invalidate":
			return handleInvalidate(args, ctx);
		case "memory_poison":
			return handlePoison(args, ctx);
		case "memory_verify":
			return handleVerify(args, ctx);
		case "memory_health":
			return handleHealth(ctx);
		case "memory_diagnose":
			return handleDiagnose(args, ctx);
		case "memory_session_start":
			return handleSessionStart(args, ctx);
		case "memory_observe":
			return handleObserve(args, ctx);
		case "memory_observe_failure":
			return handleObserveFailure(args, ctx);
		case "memory_session_end":
			return handleSessionEnd(args, ctx);
		case "memory_stop":
			return handleStop(args, ctx);
		case "memory_run_invalidation":
			return handleRunInvalidation(args, ctx);
		case "memory_audit":
			return handleAudit(args, ctx);
		case "memory_review":
			return handleReview(args, ctx);
		case "memory_resolve_contradiction":
			return handleResolveContradiction(args, ctx);
		case "memory_merge_duplicates":
			return handleMergeDuplicates(args, ctx);
		case "memory_propose":
			return handlePropose(args, ctx);
		case "memory_promote":
			return handlePromote(args, ctx);
		case "memory_deprecate":
			return handleDeprecate(args, ctx);
		case "memory_prune":
			return handlePrune(args, ctx);
		default:
			return err(`Unknown tool: ${name}`);
	}
}

async function handlePropose(args: Args, ctx: McpContext): Promise<CallToolResult> {
	try {
		const result = await ctx.promotionService.propose({
			type: args.type as MemoryType,
			title: args.title as string,
			summary: args.summary as string,
			details: args.details as string | undefined,
			scope: args.scope as import("../types.js").MemoryScope,
			impactLevel: args.impactLevel as ImpactLevel,
			knowledgeClass: args.knowledgeClass as KnowledgeClass,
			embeddingText: args.embeddingText as string,
			createdBy: (args.createdBy as string | undefined) ?? "mcp:propose",
			source: args.source as string,
			confidence: args.confidence as number,
			futureScenarios: args.futureScenarios as string[] | undefined,
			gateCleanAtProposal: args.gateCleanAtProposal as boolean | undefined,
		});
		return ok(result);
	} catch (error) {
		if (error instanceof SecretViolationError) {
			return secretViolationResult(error.violation);
		}
		throw error;
	}
}

async function handlePromote(args: Args, ctx: McpContext): Promise<CallToolResult> {
	const result = await ctx.promotionService.promote(args.proposalId as string, {
		triggeredBy: (args.triggeredBy as string | undefined) ?? "mcp:promote",
		allowedTargetTypes: args.allowedTargetTypes as MemoryType[] | undefined,
		skipDuplicateCheck: args.skipDuplicateCheck as boolean | undefined,
	});
	return ok(result);
}

async function handleDeprecate(args: Args, ctx: McpContext): Promise<CallToolResult> {
	const result = await ctx.promotionService.deprecate(
		args.id as string,
		args.reason as string,
		(args.supersededBy as string | undefined) ?? null,
		"mcp:deprecate",
	);
	return ok(result);
}

async function handlePrune(args: Args, ctx: McpContext): Promise<CallToolResult> {
	const result = await ctx.promotionService.prune({
		archivalAgeDays: args.archivalAgeDays as number | undefined,
		purgeAgeDays: args.purgeAgeDays as number | undefined,
		runPurge: (args.runPurge as boolean | undefined) ?? false,
	});
	return ok(result);
}

async function handleRetrieve(args: Args, ctx: McpContext): Promise<CallToolResult> {
	const level = LEVEL_MAP[(args.level as string) ?? "L1"] ?? "index";
	const types = (args.types as string[] | undefined) ?? [];
	const allEntries = await loadActiveEntries(ctx);
	const filters: { repository?: string; types?: MemoryType[] } = {};
	if (args.repository) filters.repository = args.repository as string;
	if (types.length > 0) filters.types = types as MemoryType[];

	const queryText = (args.query as string) ?? "";
	const { vector: queryEmbedding } = await ctx.embeddingChain.embed(queryText);
	const result = await ctx.retrievalEngine.retrieve(allEntries, {
		query: queryText,
		queryEmbedding,
		level,
		tokenBudget: (args.tokenBudget as number) ?? config.tokenBudget,
		limit: args.limit as number | undefined,
		filters: Object.keys(filters).length > 0 ? filters : undefined,
		lowTrustMode: (args.lowTrustMode as boolean) ?? false,
	});

	const rawContractEntries = result.entries.map((e) => toContractEntry(e));
	// III2 · Retrieval-Output-Filter: second-pass secret redaction at the
	// contract boundary. Catches entries that slipped past ingress (legacy
	// rows, upgrade windows, temporary detector bugs) without re-querying.
	const { entries: contractEntries, warnings } = redactEntriesForRetrieval(rawContractEntries);
	const slices: Record<string, SliceSummary> = {};
	if (types.length > 0) {
		for (const t of types) {
			const count = contractEntries.filter((e) => e.type === t).length;
			slices[t] = { status: "ok", count };
		}
	} else {
		slices["*"] = { status: "ok", count: contractEntries.length };
	}

	const envelope: RetrieveResponseV1 = {
		contract_version: CONTRACT_VERSION,
		status: computeEnvelopeStatus(slices, contractEntries.length),
		entries: contractEntries,
		slices,
		errors: [],
		...(warnings.length > 0 ? { warnings } : {}),
	};
	return ok({ ...envelope, metadata: result.metadata });
}

async function loadActiveEntries(ctx: McpContext): Promise<import("../types.js").MemoryEntry[]> {
	const validated = await ctx.entryRepo.findByStatus("validated");
	const stale = await ctx.entryRepo.findByStatus("stale");
	return [...validated, ...stale];
}

/** Body fields that `handleRetrieveDetails` exposes and that must be filtered. */
const DETAIL_REDACTED_FIELDS = ["title", "summary", "details", "embeddingText"] as const;

async function handleRetrieveDetails(args: Args, ctx: McpContext): Promise<CallToolResult> {
	const ids = args.ids as string[];
	const entries: Record<string, unknown>[] = [];
	const warnings: RetrievalWarning[] = [];
	for (const id of ids) {
		const entry = await ctx.entryRepo.findById(id);
		if (entry) {
			const evidence = await ctx.evidenceRepo.findByEntryId(id);
			const contradictions = await ctx.contradictionRepo.findByEntryId(id);
			const full = { ...entry, evidence, contradictions } as Record<string, unknown> & {
				id: string;
			};
			// III2 · Retrieval-Output-Filter parity — raw entry shape, flat fields.
			const { entry: redacted, warning } = redactDetailEntry(full, DETAIL_REDACTED_FIELDS);
			entries.push(redacted);
			if (warning) warnings.push(warning);
		}
	}
	return ok(warnings.length > 0 ? { entries, warnings } : entries);
}

async function handleIngest(args: Args, ctx: McpContext): Promise<CallToolResult> {
	const entry = await ctx.entryRepo.create({
		type: args.type as MemoryType,
		title: args.title as string,
		summary: args.summary as string,
		details: args.details as string | undefined,
		scope: {
			repository: args.repository as string,
			files: (args.files as string[]) ?? [],
			symbols: (args.symbols as string[]) ?? [],
			modules: (args.modules as string[]) ?? [],
		},
		impactLevel: (args.impactLevel as ImpactLevel) ?? "normal",
		knowledgeClass: (args.knowledgeClass as KnowledgeClass) ?? "semi_stable",
		embeddingText: `${args.title}\n${args.summary}`,
		createdBy: "agent:mcp",
	});
	return ok({
		id: entry.id,
		status: "quarantine",
		message: "Entry created. Needs validation.",
	});
}

async function handleValidate(args: Args, ctx: McpContext): Promise<CallToolResult> {
	const result = await ctx.quarantineService.validateEntry(args.id as string, "agent:mcp");
	return ok(result);
}

async function handleInvalidate(args: Args, ctx: McpContext): Promise<CallToolResult> {
	const mode = (args.mode as string) ?? "soft";
	const result =
		mode === "soft"
			? await softInvalidate(args.id as string, args.reason as string, ctx.entryRepo, "agent:mcp")
			: await hardInvalidate(args.id as string, args.reason as string, ctx.entryRepo, "agent:mcp");
	return ok(result);
}

async function handlePoison(args: Args, ctx: McpContext): Promise<CallToolResult> {
	const svc = new RollbackService(ctx.sql, ctx.poisonService);
	const report = await svc.poisonAndReport(args.id as string, args.reason as string, "agent:mcp");
	return ok(report);
}

async function handleVerify(args: Args, ctx: McpContext): Promise<CallToolResult> {
	const entry = await ctx.entryRepo.findById(args.id as string);
	if (!entry) return err("Entry not found");
	const evidence = await ctx.evidenceRepo.findByEntryId(args.id as string);
	const contradictions = await ctx.contradictionRepo.findByEntryId(args.id as string);
	const history = await ctx.sql`
    SELECT from_status, to_status, reason, triggered_by, created_at
    FROM memory_status_history WHERE memory_entry_id = ${args.id as string}
    ORDER BY created_at DESC LIMIT 20
  `;
	return ok({
		entry: {
			id: entry.id,
			title: entry.title,
			type: entry.type,
			status: entry.trust.status,
			trustScore: entry.trust.score,
		},
		evidence: evidence.map((e) => ({
			id: e.id,
			kind: e.kind,
			ref: e.ref,
			verified: !!e.verifiedAt,
		})),
		contradictions: contradictions.map((c) => ({
			id: c.id,
			resolved: !!c.resolvedAt,
		})),
		statusHistory: history.map((h) => ({
			from: h.from_status,
			to: h.to_status,
			reason: h.reason,
			by: h.triggered_by,
			at: h.created_at,
		})),
	});
}

async function handleHealth(ctx: McpContext): Promise<CallToolResult> {
	const db = await healthCheck();
	const counts =
		await ctx.sql`SELECT trust_status, COUNT(*)::int AS count FROM memory_entries GROUP BY trust_status`;
	const avgTrust =
		await ctx.sql`SELECT COALESCE(AVG(trust_score), 0)::float AS avg FROM memory_entries WHERE trust_status = 'validated'`;
	const envelope: HealthResponseV1 = {
		contract_version: CONTRACT_VERSION,
		status: db.ok ? "ok" : "error",
		backend_version: ctx.backendVersion,
		features: [...BACKEND_FEATURES],
		latency_ms: db.latencyMs,
		counts: Object.fromEntries(counts.map((r) => [r.trust_status, r.count])),
	};
	return ok({
		...envelope,
		database: db,
		entries: envelope.counts,
		avgTrustScore: avgTrust[0]?.avg ?? 0,
	});
}

async function handleDiagnose(args: Args, ctx: McpContext): Promise<CallToolResult> {
	const max = (args.maxResults as number) ?? 10;
	const stale =
		await ctx.sql`SELECT id, title, impact_level FROM memory_entries WHERE trust_status = 'stale' LIMIT ${max}`;
	const lowTrust =
		await ctx.sql`SELECT id, title, trust_score FROM memory_entries WHERE trust_status = 'validated' AND trust_score < 0.4 LIMIT ${max}`;
	return ok({ staleEntries: stale, lowTrustEntries: lowTrust });
}

async function handleSessionStart(args: Args, ctx: McpContext): Promise<CallToolResult> {
	const expiryResult = await ctx.ttlExpiryJob.run();
	const query = args.query as string;
	let context: unknown[] = [];
	if (query) {
		const allEntries = await loadActiveEntries(ctx);
		const { vector: queryEmbedding } = await ctx.embeddingChain.embed(query);
		const retrieval = await ctx.retrievalEngine.retrieve(allEntries, {
			query,
			queryEmbedding,
			level: "index",
			tokenBudget: (args.tokenBudget as number) ?? config.tokenBudget,
			filters: args.repository ? { repository: args.repository as string } : undefined,
		});
		context = retrieval.entries;
	}
	return ok({
		session: { id: args.sessionId, repository: args.repository },
		context,
		maintenance: { expired: expiryResult.staledCount },
	});
}

async function handleObserve(args: Args, ctx: McpContext): Promise<CallToolResult> {
	const raw = args.content as string;
	// Reject-by-default (roadmap principle): any SECRET_DETECTED / HIGH_ENTROPY
	// hit throws SecretViolationError, which the top-level handleToolCall
	// turns into INGRESS_POLICY_VIOLATION. PII (email/phone/paths/.env lines)
	// is still redacted downstream via applyPrivacyFilter.
	enforceNoSecrets({ content: raw }, config.security.secretPolicy);
	const filtered = applyPrivacyFilter(raw);
	const obs = await ctx.observationRepo.create(
		args.sessionId as string,
		filtered,
		(args.source as string) ?? "tool-use",
	);
	if (!obs) return ok({ stored: false, reason: "Duplicate (deduped)" });
	return ok({ stored: true, id: obs.id });
}

async function handleObserveFailure(args: Args, ctx: McpContext): Promise<CallToolResult> {
	const parts: string[] = [
		`tool=${args.toolName as string}`,
		`error=${args.errorMessage as string}`,
	];
	if (args.stderr) parts.push(`stderr=${String(args.stderr)}`);
	if (args.stack) parts.push(`stack=${String(args.stack)}`);
	const joined = parts.join("\n");
	// Same reject-by-default gate as handleObserve — stack traces and stderr
	// are a well-known leak vector for tokens pasted into error messages.
	enforceNoSecrets(
		{
			errorMessage: args.errorMessage as string | undefined,
			stderr: args.stderr as string | undefined,
			stack: args.stack as string | undefined,
		},
		config.security.secretPolicy,
	);
	const content = applyPrivacyFilter(joined);
	const obs = await ctx.observationRepo.create(
		args.sessionId as string,
		content,
		`failure:${args.toolName as string}`,
	);
	if (!obs) return ok({ stored: false, reason: "Duplicate (deduped)" });
	return ok({ stored: true, id: obs.id, kind: "failure" });
}

async function handleSessionEnd(args: Args, ctx: McpContext): Promise<CallToolResult> {
	const consolidator = new WorkingToEpisodicConsolidator(ctx.observationRepo, ctx.entryRepo);
	const consolidation = await consolidator.consolidate(
		args.sessionId as string,
		args.repository as string,
	);
	const revalidation = await ctx.revalidationJob.run(10);
	return ok({
		consolidation: consolidation
			? {
					entryId: consolidation.createdEntryId,
					observations: consolidation.observationCount,
				}
			: null,
		revalidation: {
			processed: revalidation.processed,
			revalidated: revalidation.revalidated,
			rejected: revalidation.rejected,
		},
	});
}

async function handleStop(args: Args, ctx: McpContext): Promise<CallToolResult> {
	const guard = new ExtractionGuard({
		root: ctx.repoRoot,
		testCommand: args.testCommand as string | undefined,
		qualityCommand: args.qualityCommand as string | undefined,
		skipChecks: (args.skipChecks as boolean | undefined) ?? false,
	});
	const guardResult = await guard.check();
	if (!guardResult.allowed) {
		return ok({
			guard: guardResult,
			consolidation: null,
			extraction: "blocked",
		});
	}
	const consolidator = new WorkingToEpisodicConsolidator(ctx.observationRepo, ctx.entryRepo);
	const consolidation = await consolidator.consolidate(
		args.sessionId as string,
		args.repository as string,
	);
	return ok({
		guard: guardResult,
		consolidation: consolidation
			? {
					entryId: consolidation.createdEntryId,
					observations: consolidation.observationCount,
				}
			: null,
		extraction: "allowed",
	});
}

async function handleRunInvalidation(args: Args, ctx: McpContext): Promise<CallToolResult> {
	const result = await ctx.invalidationOrchestrator.run({
		root: ctx.repoRoot,
		fromRef: args.fromRef as string | undefined,
		sinceDate: args.sinceDate as string | undefined,
	});
	return ok(result);
}

async function handleAudit(args: Args, ctx: McpContext): Promise<CallToolResult> {
	const id = args.id as string;
	const entry = await ctx.entryRepo.findById(id);
	if (!entry) return err("Entry not found");
	const evidence = await ctx.evidenceRepo.findByEntryId(id);
	const contradictions = await ctx.contradictionRepo.findByEntryId(id);
	const history = await ctx.sql`
    SELECT from_status, to_status, reason, triggered_by, created_at
    FROM memory_status_history WHERE memory_entry_id = ${id}
    ORDER BY created_at ASC
  `;
	return ok({
		entry,
		evidence,
		contradictions,
		statusHistory: history,
		accessPattern: {
			count: entry.accessCount,
			lastAccessed: entry.lastAccessedAt,
		},
	});
}

async function handleReview(args: Args, ctx: McpContext): Promise<CallToolResult> {
	const max = (args.maxResults as number) ?? 10;
	const metrics = await calculateMetrics(ctx.sql);
	const unresolved = await listUnresolved(ctx.sql);
	const duplicates = await findDuplicates(ctx.sql);
	const stale =
		await ctx.sql`SELECT id, title, impact_level FROM memory_entries WHERE trust_status = 'stale' ORDER BY impact_level LIMIT ${max}`;
	const lowTrust =
		await ctx.sql`SELECT id, title, trust_score FROM memory_entries WHERE trust_status = 'validated' AND trust_score < 0.4 ORDER BY trust_score LIMIT ${max}`;
	return ok({
		metrics,
		unresolvedContradictions: unresolved.slice(0, max),
		duplicates: duplicates.slice(0, max),
		staleEntries: stale,
		lowTrustEntries: lowTrust,
	});
}

async function handleResolveContradiction(args: Args, ctx: McpContext): Promise<CallToolResult> {
	const result = await resolveContradiction(
		args.contradictionId as string,
		args.strategy as ResolutionStrategy,
		ctx.contradictionRepo,
		ctx.entryRepo,
		ctx.sql,
	);
	return ok(result);
}

async function handleMergeDuplicates(args: Args, ctx: McpContext): Promise<CallToolResult> {
	const ids = args.entryIds as string[];
	if (ids.length < 2) return err("Need at least 2 entry IDs to merge");
	const entries = [];
	for (const id of ids) {
		const entry = await ctx.entryRepo.findById(id);
		if (!entry) return err(`Entry not found: ${id}`);
		entries.push({
			id: entry.id,
			title: entry.title,
			trustScore: entry.trust.score,
			accessCount: entry.accessCount,
		});
	}
	const result = await mergeDuplicates(
		{ entries, reason: "Manual merge via MCP" },
		ctx.entryRepo,
		ctx.evidenceRepo,
		ctx.sql,
	);
	return ok(result);
}
