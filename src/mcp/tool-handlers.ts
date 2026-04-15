import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { McpContext } from "./context.js";
import type { MemoryType, ImpactLevel, KnowledgeClass } from "../types.js";
import type { DisclosureLevel } from "../retrieval/progressive-disclosure.js";
import { config } from "../config.js";
import { healthCheck } from "../db/connection.js";
import { softInvalidate, hardInvalidate } from "../invalidation/invalidation-flows.js";
import { RollbackService } from "../invalidation/rollback.js";
import { WorkingToEpisodicConsolidator } from "../consolidation/working-to-episodic.js";
import { applyPrivacyFilter } from "../ingestion/privacy-filter.js";
import { calculateMetrics } from "../quality/metrics.js";
import { findDuplicates, mergeDuplicates } from "../quality/dedup.js";
import { listUnresolved, resolveContradiction, type ResolutionStrategy } from "../quality/contradiction-resolution.js";

function ok(data: unknown): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}

function err(message: string): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify({ error: message }) }], isError: true };
}

type Args = Record<string, unknown>;

const LEVEL_MAP: Record<string, DisclosureLevel> = { L1: "index", L2: "timeline", L3: "full" };

export async function handleToolCall(name: string, args: Args, ctx: McpContext): Promise<CallToolResult> {
  switch (name) {
    case "memory_retrieve": return handleRetrieve(args, ctx);
    case "memory_retrieve_details": return handleRetrieveDetails(args, ctx);
    case "memory_ingest": return handleIngest(args, ctx);
    case "memory_validate": return handleValidate(args, ctx);
    case "memory_invalidate": return handleInvalidate(args, ctx);
    case "memory_poison": return handlePoison(args, ctx);
    case "memory_verify": return handleVerify(args, ctx);
    case "memory_health": return handleHealth(ctx);
    case "memory_diagnose": return handleDiagnose(args, ctx);
    case "memory_session_start": return handleSessionStart(args, ctx);
    case "memory_observe": return handleObserve(args, ctx);
    case "memory_session_end": return handleSessionEnd(args, ctx);
    case "memory_run_invalidation": return handleRunInvalidation(args, ctx);
    case "memory_audit": return handleAudit(args, ctx);
    case "memory_review": return handleReview(args, ctx);
    case "memory_resolve_contradiction": return handleResolveContradiction(args, ctx);
    case "memory_merge_duplicates": return handleMergeDuplicates(args, ctx);
    default: return err(`Unknown tool: ${name}`);
  }
}

async function handleRetrieve(args: Args, ctx: McpContext): Promise<CallToolResult> {
  const level = LEVEL_MAP[(args.level as string) ?? "L1"] ?? "index";
  const allEntries = await loadActiveEntries(ctx);
  const result = await ctx.retrievalEngine.retrieve(allEntries, {
    query: args.query as string,
    level,
    tokenBudget: (args.tokenBudget as number) ?? config.tokenBudget,
    filters: args.repository ? { repository: args.repository as string } : undefined,
    lowTrustMode: (args.lowTrustMode as boolean) ?? false,
  });
  return ok({ entries: result.entries, metadata: result.metadata });
}

async function loadActiveEntries(ctx: McpContext): Promise<import("../types.js").MemoryEntry[]> {
  const validated = await ctx.entryRepo.findByStatus("validated");
  const stale = await ctx.entryRepo.findByStatus("stale");
  return [...validated, ...stale];
}

async function handleRetrieveDetails(args: Args, ctx: McpContext): Promise<CallToolResult> {
  const ids = args.ids as string[];
  const entries = [];
  for (const id of ids) {
    const entry = await ctx.entryRepo.findById(id);
    if (entry) {
      const evidence = await ctx.evidenceRepo.findByEntryId(id);
      const contradictions = await ctx.contradictionRepo.findByEntryId(id);
      entries.push({ ...entry, evidence, contradictions });
    }
  }
  return ok(entries);
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
  return ok({ id: entry.id, status: "quarantine", message: "Entry created. Needs validation." });
}

async function handleValidate(args: Args, ctx: McpContext): Promise<CallToolResult> {
  const result = await ctx.quarantineService.validateEntry(args.id as string, "agent:mcp");
  return ok(result);
}

async function handleInvalidate(args: Args, ctx: McpContext): Promise<CallToolResult> {
  const mode = (args.mode as string) ?? "soft";
  const result = mode === "soft"
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
    entry: { id: entry.id, title: entry.title, type: entry.type, status: entry.trust.status, trustScore: entry.trust.score },
    evidence: evidence.map((e) => ({ id: e.id, kind: e.kind, ref: e.ref, verified: !!e.verifiedAt })),
    contradictions: contradictions.map((c) => ({ id: c.id, resolved: !!c.resolvedAt })),
    statusHistory: history.map((h) => ({ from: h.from_status, to: h.to_status, reason: h.reason, by: h.triggered_by, at: h.created_at })),
  });
}

async function handleHealth(ctx: McpContext): Promise<CallToolResult> {
  const db = await healthCheck();
  const counts = await ctx.sql`SELECT trust_status, COUNT(*)::int AS count FROM memory_entries GROUP BY trust_status`;
  const avgTrust = await ctx.sql`SELECT COALESCE(AVG(trust_score), 0)::float AS avg FROM memory_entries WHERE trust_status = 'validated'`;
  return ok({ database: db, entries: Object.fromEntries(counts.map((r) => [r.trust_status, r.count])), avgTrustScore: avgTrust[0]?.avg ?? 0 });
}

async function handleDiagnose(args: Args, ctx: McpContext): Promise<CallToolResult> {
  const max = (args.maxResults as number) ?? 10;
  const stale = await ctx.sql`SELECT id, title, impact_level FROM memory_entries WHERE trust_status = 'stale' LIMIT ${max}`;
  const lowTrust = await ctx.sql`SELECT id, title, trust_score FROM memory_entries WHERE trust_status = 'validated' AND trust_score < 0.4 LIMIT ${max}`;
  return ok({ staleEntries: stale, lowTrustEntries: lowTrust });
}

async function handleSessionStart(args: Args, ctx: McpContext): Promise<CallToolResult> {
  const expiryResult = await ctx.ttlExpiryJob.run();
  const query = args.query as string;
  let context: unknown[] = [];
  if (query) {
    const allEntries = await loadActiveEntries(ctx);
    const retrieval = await ctx.retrievalEngine.retrieve(allEntries, {
      query,
      level: "index",
      tokenBudget: (args.tokenBudget as number) ?? config.tokenBudget,
      filters: args.repository ? { repository: args.repository as string } : undefined,
    });
    context = retrieval.entries;
  }
  return ok({ session: { id: args.sessionId, repository: args.repository }, context, maintenance: { expired: expiryResult.staledCount } });
}

async function handleObserve(args: Args, ctx: McpContext): Promise<CallToolResult> {
  const filtered = applyPrivacyFilter(args.content as string);
  const obs = await ctx.observationRepo.create(args.sessionId as string, filtered, (args.source as string) ?? "tool-use");
  if (!obs) return ok({ stored: false, reason: "Duplicate (deduped)" });
  return ok({ stored: true, id: obs.id });
}

async function handleSessionEnd(args: Args, ctx: McpContext): Promise<CallToolResult> {
  const consolidator = new WorkingToEpisodicConsolidator(ctx.observationRepo, ctx.entryRepo);
  const consolidation = await consolidator.consolidate(args.sessionId as string, args.repository as string);
  const revalidation = await ctx.revalidationJob.run(10);
  return ok({
    consolidation: consolidation ? { entryId: consolidation.createdEntryId, observations: consolidation.observationCount } : null,
    revalidation: { processed: revalidation.processed, revalidated: revalidation.revalidated, rejected: revalidation.rejected },
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
    entry, evidence, contradictions,
    statusHistory: history,
    accessPattern: { count: entry.accessCount, lastAccessed: entry.lastAccessedAt },
  });
}

async function handleReview(args: Args, ctx: McpContext): Promise<CallToolResult> {
  const max = (args.maxResults as number) ?? 10;
  const metrics = await calculateMetrics(ctx.sql);
  const unresolved = await listUnresolved(ctx.sql);
  const duplicates = await findDuplicates(ctx.sql);
  const stale = await ctx.sql`SELECT id, title, impact_level FROM memory_entries WHERE trust_status = 'stale' ORDER BY impact_level LIMIT ${max}`;
  const lowTrust = await ctx.sql`SELECT id, title, trust_score FROM memory_entries WHERE trust_status = 'validated' AND trust_score < 0.4 ORDER BY trust_score LIMIT ${max}`;
  return ok({ metrics, unresolvedContradictions: unresolved.slice(0, max), duplicates: duplicates.slice(0, max), staleEntries: stale, lowTrustEntries: lowTrust });
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
    entries.push({ id: entry.id, title: entry.title, trustScore: entry.trust.score, accessCount: entry.accessCount });
  }
  const result = await mergeDuplicates(
    { entries, reason: "Manual merge via MCP" },
    ctx.entryRepo, ctx.evidenceRepo, ctx.sql,
  );
  return ok(result);
}