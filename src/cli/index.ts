#!/usr/bin/env node
// Default to silent logger for CLI usage unless caller overrides.
// Must happen before any import that touches the logger (config/db).
process.env.LOG_LEVEL ??= "silent";

import { Command } from "commander";
import { closeDb, getDb, healthCheck } from "../db/connection.js";
import { ContradictionRepository } from "../db/repositories/contradiction.repository.js";
import { EvidenceRepository } from "../db/repositories/evidence.repository.js";
import { MemoryEntryRepository } from "../db/repositories/memory-entry.repository.js";
import { MemoryEventRepository } from "../db/repositories/memory-event.repository.js";
import { buildEmbeddingChain } from "../embedding/index.js";
import { hardInvalidate, softInvalidate } from "../invalidation/invalidation-flows.js";
import { InvalidationOrchestrator } from "../invalidation/orchestrator.js";
import { RollbackService } from "../invalidation/rollback.js";
import {
	BACKEND_FEATURES,
	CONTRACT_VERSION,
	computeEnvelopeStatus,
	type HealthResponseV1,
	type RetrieveResponseV1,
	type SliceSummary,
	toContractEntry,
} from "../retrieval/contract.js";
import { RetrievalEngine } from "../retrieval/engine.js";
import type { DisclosureLevel } from "../retrieval/progressive-disclosure.js";
import { redactEntriesForRetrieval } from "../security/retrieval-redaction.js";
import {
	type AuditEntryFinding,
	auditEntry,
	planArchiveTransitions,
	planRedactPatch,
} from "../security/secret-audit.js";
import { SecretViolationError } from "../security/secret-guard.js";
import { CATALOG_VERSION } from "../security/secret-patterns.js";
import { SECRET_VIOLATION_EXIT_CODE } from "../security/secret-violation.js";
import { PoisonService } from "../trust/poison.service.js";
import { PromotionService } from "../trust/promotion.service.js";
import { QuarantineService } from "../trust/quarantine.service.js";
import { DiffImpactValidator } from "../trust/validators/diff-impact.validator.js";
import { FileExistsValidator } from "../trust/validators/file-exists.validator.js";
import { SymbolExistsValidator } from "../trust/validators/symbol-exists.validator.js";
import { TestLinkedValidator } from "../trust/validators/test-linked.validator.js";
import type { ImpactLevel, KnowledgeClass, MemoryType } from "../types.js";
import { isMainModule } from "../utils/is-main-module.js";

const BACKEND_VERSION = "0.1.0";
const HEALTH_TIMEOUT_MS = 2000;

const collect = (value: string, previous: string[]): string[] => [...previous, value];

const program = new Command();

program
	.name("memory")
	.description("Agent Memory — persistent, trust-scored project knowledge")
	.version(BACKEND_VERSION);

program
	.command("ingest")
	.description("Create a memory entry in quarantine (one-shot; parity with mcp.memory_ingest)")
	.requiredOption("--type <type>", "Memory type (e.g., architecture_decision)")
	.requiredOption("--title <title>", "Short title")
	.requiredOption("--summary <summary>", "One-paragraph summary")
	.option("--details <details>", "Optional long-form details")
	.requiredOption("--repository <repository>", "Repository identifier")
	.option("--file <path>", "File in scope (repeatable)", collect, [])
	.option("--symbol <symbol>", "Symbol in scope (repeatable)", collect, [])
	.option("--module <module>", "Module in scope (repeatable)", collect, [])
	.option("--impact <level>", "Impact level (critical|high|normal|low)", "normal")
	.option(
		"--knowledge-class <class>",
		"Knowledge class (evergreen|semi_stable|volatile)",
		"semi_stable",
	)
	.option("--created-by <actor>", "Caller identifier", "cli:ingest")
	.action(async (options) => {
		try {
			const sql = getDb();
			const entryRepo = new MemoryEntryRepository(sql);
			const entry = await entryRepo.create({
				type: options.type as MemoryType,
				title: options.title,
				summary: options.summary,
				details: options.details,
				scope: {
					repository: options.repository,
					files: options.file,
					symbols: options.symbol,
					modules: options.module,
				},
				impactLevel: options.impact as ImpactLevel,
				knowledgeClass: options.knowledgeClass as KnowledgeClass,
				embeddingText: `${options.title}\n${options.summary}`,
				createdBy: options.createdBy,
			});
			console.log(
				JSON.stringify(
					{
						id: entry.id,
						status: "quarantine",
						message: "Entry created. Needs validation.",
					},
					null,
					2,
				),
			);
			await closeDb();
			process.exit(0);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			console.error(JSON.stringify({ error: message }, null, 2));
			await closeDb();
			process.exit(1);
		}
	});

program
	.command("retrieve")
	.description("Query memory for relevant knowledge (contract v1 envelope)")
	.argument("<query>", "Natural language query")
	.option("--layer <n>", "Disclosure layer (1|2|3 or L1|L2|L3)", "2")
	.option("--budget <tokens>", "Max token budget", "2000")
	.option("--limit <n>", "Max result count")
	.option("--low-trust", "Include low-trust entries (lower threshold, marked)")
	.option("--type <type>", "Filter by memory type (repeatable)", collect, [])
	.option("--repository <id>", "Filter by repository")
	.action(async (query, options) => {
		try {
			const sql = getDb();
			const entryRepo = new MemoryEntryRepository(sql);
			const engine = new RetrievalEngine(sql);
			const validated = await entryRepo.findByStatus("validated");
			const stale = await entryRepo.findByStatus("stale");
			const allEntries = [...validated, ...stale];
			const level = parseLevel(options.layer);
			const typeFilter = options.type as MemoryType[];
			const filters: { repository?: string; types?: MemoryType[] } = {};
			if (options.repository) filters.repository = options.repository;
			if (typeFilter.length > 0) filters.types = typeFilter;
			const chain = buildEmbeddingChain();
			const { vector: queryEmbedding } = await chain.embed(query);
			const result = await engine.retrieve(allEntries, {
				query,
				queryEmbedding,
				level,
				tokenBudget: Number.parseInt(options.budget, 10),
				limit: options.limit ? Number.parseInt(options.limit, 10) : undefined,
				filters: Object.keys(filters).length > 0 ? filters : undefined,
				lowTrustMode: !!options.lowTrust,
			});
			const rawContractEntries = result.entries.map((e) => toContractEntry(e));
			// III2 · Retrieval-Output-Filter — same safety net as MCP.
			const { entries: contractEntries, warnings } = redactEntriesForRetrieval(rawContractEntries);
			const slices: Record<string, SliceSummary> = {};
			if (typeFilter.length > 0) {
				for (const t of typeFilter) {
					slices[t] = {
						status: "ok",
						count: contractEntries.filter((e) => e.type === t).length,
					};
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
			console.log(JSON.stringify({ ...envelope, metadata: result.metadata }, null, 2));
			await closeDb();
			process.exit(0);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			console.error(JSON.stringify({ error: message }, null, 2));
			await closeDb();
			process.exit(1);
		}
	});

program
	.command("validate")
	.description("Run validators against a quarantined entry")
	.argument("<id>", "Memory entry ID")
	.option("--triggered-by <actor>", "Caller identifier", "cli:validate")
	.action(async (id, options) => {
		try {
			const service = buildQuarantineService();
			const result = await service.validateEntry(id, options.triggeredBy);
			console.log(JSON.stringify(result, null, 2));
			await closeDb();
			process.exit(0);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			console.error(JSON.stringify({ error: message }, null, 2));
			await closeDb();
			process.exit(1);
		}
	});

program
	.command("invalidate")
	.description("Mark entries as stale or rejected (soft/hard or git-diff sweep)")
	.option("--entry <id>", "Invalidate a specific entry")
	.option("--hard", "Hard invalidation (entry is completely wrong)")
	.option("--reason <text>", "Reason for invalidation", "cli:invalidate")
	.option("--from-git-diff", "Run git-diff invalidation orchestrator (sweeps all affected entries)")
	.option("--from-ref <ref>", "Git ref to compare from (with --from-git-diff)")
	.option("--since <date>", "Alternative to --from-ref — ISO date (with --from-git-diff)")
	.option("--triggered-by <actor>", "Caller identifier", "cli:invalidate")
	.action(async (options) => {
		try {
			const sql = getDb();
			const entryRepo = new MemoryEntryRepository(sql);
			if (options.fromGitDiff) {
				const evidenceRepo = new EvidenceRepository(sql);
				const repoRoot = process.env.REPO_ROOT ?? process.cwd();
				const orchestrator = new InvalidationOrchestrator(sql, entryRepo, evidenceRepo);
				const result = await orchestrator.run({
					root: repoRoot,
					fromRef: options.fromRef,
					sinceDate: options.since,
				});
				console.log(JSON.stringify(result, null, 2));
			} else if (options.entry) {
				const result = options.hard
					? await hardInvalidate(options.entry, options.reason, entryRepo, options.triggeredBy)
					: await softInvalidate(options.entry, options.reason, entryRepo, options.triggeredBy);
				console.log(JSON.stringify(result, null, 2));
			} else {
				throw new Error("Provide either --entry <id> or --from-git-diff");
			}
			await closeDb();
			process.exit(0);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			console.error(JSON.stringify({ error: message }, null, 2));
			await closeDb();
			process.exit(1);
		}
	});

program
	.command("poison")
	.description("Mark an entry as poisoned — cascade review + rollback report")
	.argument("<id>", "Memory entry ID")
	.argument("<reason>", "Why this entry is wrong")
	.option("--triggered-by <actor>", "Caller identifier", "cli:poison")
	.action(async (id, reason, options) => {
		try {
			const sql = getDb();
			const entryRepo = new MemoryEntryRepository(sql);
			const poisonService = new PoisonService(sql, entryRepo);
			const rollback = new RollbackService(sql, poisonService);
			const report = await rollback.poisonAndReport(id, reason, options.triggeredBy);
			console.log(JSON.stringify(report, null, 2));
			await closeDb();
			process.exit(0);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			console.error(JSON.stringify({ error: message }, null, 2));
			await closeDb();
			process.exit(1);
		}
	});

program
	.command("rollback")
	.description("Roll back a poisoned entry — report affected tasks + cascaded entries")
	.argument("<id>", "Memory entry ID to roll back")
	.option("--reason <text>", "Why this entry is being rolled back", "Rolled back via CLI")
	.option("--triggered-by <actor>", "Caller identifier", "cli:rollback")
	.action(async (id, options) => {
		try {
			const sql = getDb();
			const entryRepo = new MemoryEntryRepository(sql);
			const poisonService = new PoisonService(sql, entryRepo);
			const rollback = new RollbackService(sql, poisonService);
			const report = await rollback.poisonAndReport(id, options.reason, options.triggeredBy);
			const output = {
				rolledBackEntryId: report.poisonedEntryId,
				cascadedEntryIds: report.cascadedEntryIds,
				affectedTasks: report.affectedTasks,
				summary: {
					cascadedCount: report.cascadedEntryIds.length,
					taskCount: report.affectedTasks.length,
				},
			};
			console.log(JSON.stringify(output, null, 2));
			await closeDb();
			process.exit(0);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			console.error(JSON.stringify({ error: message }, null, 2));
			await closeDb();
			process.exit(1);
		}
	});

program
	.command("verify")
	.description("Trace a memory entry to its evidence, contradictions, and audit trail")
	.argument("<id>", "Memory entry ID")
	.action(async (id) => {
		try {
			const sql = getDb();
			const entryRepo = new MemoryEntryRepository(sql);
			const evidenceRepo = new EvidenceRepository(sql);
			const contradictionRepo = new ContradictionRepository(sql);
			const entry = await entryRepo.findById(id);
			if (!entry) throw new Error(`Entry not found: ${id}`);
			const evidence = await evidenceRepo.findByEntryId(id);
			const contradictions = await contradictionRepo.findByEntryId(id);
			const history = await sql`
				SELECT from_status, to_status, reason, triggered_by, created_at
				FROM memory_status_history WHERE memory_entry_id = ${id}
				ORDER BY created_at DESC LIMIT 20
			`;
			console.log(
				JSON.stringify(
					{
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
					},
					null,
					2,
				),
			);
			await closeDb();
			process.exit(0);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			console.error(JSON.stringify({ error: message }, null, 2));
			await closeDb();
			process.exit(1);
		}
	});

program
	.command("propose")
	.description("Propose a new memory entry (lands in quarantine; not served until promoted)")
	.requiredOption("--type <type>", "Memory type (e.g., architecture_decision)")
	.requiredOption("--title <title>", "Short title")
	.requiredOption("--summary <summary>", "One-paragraph summary")
	.option("--details <details>", "Optional long-form details")
	.requiredOption("--repository <repository>", "Repository identifier")
	.option("--file <path>", "File in scope (repeatable)", collect, [])
	.option("--symbol <symbol>", "Symbol in scope (repeatable)", collect, [])
	.option("--module <module>", "Module in scope (repeatable)", collect, [])
	.option("--impact <level>", "Impact level (critical|high|normal|low)", "normal")
	.option(
		"--knowledge-class <class>",
		"Knowledge class (evergreen|semi_stable|volatile)",
		"semi_stable",
	)
	.requiredOption("--source <source>", "Source ref (incident id, PR, ADR)")
	.requiredOption("--confidence <n>", "Initial confidence 0.0–1.0", "0.6")
	.option("--scenario <text>", "Future scenario (repeat 3+ times for non-low impact)", collect, [])
	.option("--gate-clean", "Assert extraction-guard was clean at proposal time", false)
	.option(
		"--gate-not-clean",
		"Mark extraction-guard as failing (will cause rejection on promote)",
		false,
	)
	.option("--created-by <actor>", "Caller identifier", "cli:propose")
	.action(async (options) => {
		try {
			const service = buildPromotionService();
			const gateCleanAtProposal = options.gateNotClean
				? false
				: options.gateClean
					? true
					: undefined;
			const result = await service.propose({
				type: options.type as MemoryType,
				title: options.title,
				summary: options.summary,
				details: options.details,
				scope: {
					repository: options.repository,
					files: options.file,
					symbols: options.symbol,
					modules: options.module,
				},
				impactLevel: options.impact as ImpactLevel,
				knowledgeClass: options.knowledgeClass as KnowledgeClass,
				embeddingText: `${options.title}\n${options.summary}`,
				createdBy: options.createdBy,
				source: options.source,
				confidence: Number.parseFloat(options.confidence),
				futureScenarios: options.scenario.length > 0 ? options.scenario : undefined,
				gateCleanAtProposal,
				actor: "user:cli",
				ingressPath: "cli_propose",
			});
			console.log(JSON.stringify(result, null, 2));
			await closeDb();
			process.exit(0);
		} catch (error) {
			if (error instanceof SecretViolationError) {
				console.error(JSON.stringify(error.violation, null, 2));
				await closeDb();
				process.exit(SECRET_VIOLATION_EXIT_CODE);
			}
			const message = error instanceof Error ? error.message : String(error);
			console.error(JSON.stringify({ error: message }, null, 2));
			await closeDb();
			process.exit(1);
		}
	});

program
	.command("promote")
	.description("Promote a quarantined proposal through gate criteria")
	.argument("<proposal-id>", "Proposal ID returned by `propose`")
	.option("--allowed-type <type>", "Allowed target type (repeatable; consumer policy)", collect, [])
	.option("--skip-duplicate-check", "Skip non-duplication gate (caller accepts the sibling)", false)
	.option("--triggered-by <actor>", "Caller identifier", "cli:promote")
	.action(async (proposalId, options) => {
		try {
			const service = buildPromotionService();
			const result = await service.promote(proposalId, {
				triggeredBy: options.triggeredBy,
				allowedTargetTypes:
					options.allowedType.length > 0 ? (options.allowedType as MemoryType[]) : undefined,
				skipDuplicateCheck: options.skipDuplicateCheck,
			});
			console.log(JSON.stringify(result, null, 2));
			await closeDb();
			process.exit(result.status === "validated" ? 0 : 1);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			console.error(JSON.stringify({ error: message }, null, 2));
			await closeDb();
			process.exit(1);
		}
	});

program
	.command("health")
	.description("Probe backend health — returns contract v1 envelope as JSON")
	.option("--timeout <ms>", "Timeout in ms", String(HEALTH_TIMEOUT_MS))
	.action(async (options) => {
		const timeoutMs = Number.parseInt(options.timeout, 10) || HEALTH_TIMEOUT_MS;
		const envelope = await probeHealth(timeoutMs);
		console.log(JSON.stringify(envelope, null, 2));
		await closeDb();
		process.exit(envelope.status === "ok" ? 0 : 1);
	});

program
	.command("status")
	.description("Feature detection for consumers — prints present | absent | misconfigured")
	.option("--timeout <ms>", "Timeout in ms", String(HEALTH_TIMEOUT_MS))
	.option("--json", "Emit full JSON envelope (always exits 0)")
	.action(async (options) => {
		const timeoutMs = Number.parseInt(options.timeout, 10) || HEALTH_TIMEOUT_MS;
		const envelope = await probeHealth(timeoutMs);
		const memoryStatus: "present" | "absent" | "misconfigured" =
			envelope.status === "ok" ? "present" : "misconfigured";
		if (options.json) {
			console.log(JSON.stringify({ memory_status: memoryStatus, ...envelope }, null, 2));
		} else {
			console.log(memoryStatus);
		}
		await closeDb();
		process.exit(0);
	});

program
	.command("diagnose")
	.description("Identify issues: stale entries, low-trust entries")
	.option("--max-results <n>", "Max entries per category", "10")
	.action(async (options) => {
		try {
			const sql = getDb();
			const max = Number.parseInt(options.maxResults, 10);
			const staleEntries = await sql`
				SELECT id, title, impact_level FROM memory_entries
				WHERE trust_status = 'stale' LIMIT ${max}
			`;
			const lowTrustEntries = await sql`
				SELECT id, title, trust_score FROM memory_entries
				WHERE trust_status = 'validated' AND trust_score < 0.4 LIMIT ${max}
			`;
			console.log(JSON.stringify({ staleEntries, lowTrustEntries }, null, 2));
			await closeDb();
			process.exit(0);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			console.error(JSON.stringify({ error: message }, null, 2));
			await closeDb();
			process.exit(1);
		}
	});

const auditCommand = program
	.command("audit")
	.description("Run audits across memory stores (subcommands)");

auditCommand
	.command("secrets")
	.description("III1 · Scan memory_entries for secrets; with --fix, redact or archive matches")
	.option("--fix", "Apply fixes to matched entries (requires --mode)", false)
	.option("--mode <mode>", "Fix mode when --fix is set: redact | archive")
	.option("--batch-size <n>", "Rows per keyset page", "500")
	.action(async (options) => {
		try {
			const sql = getDb();
			const entryRepo = new MemoryEntryRepository(sql);
			const batchSize = Math.max(1, Number.parseInt(options.batchSize, 10) || 500);
			const fix = !!options.fix;
			const mode = options.mode as "redact" | "archive" | undefined;
			if (fix && mode !== "redact" && mode !== "archive") {
				throw new Error("--fix requires --mode=redact or --mode=archive");
			}

			const { logger } = await import("../utils/logger.js");
			const findings: AuditEntryFinding[] = [];
			const redacted: Array<{ id: string; patterns: string[]; fields: string[] }> = [];
			const archived: Array<{
				id: string;
				transitions: Array<{ from: string; to: string }>;
			}> = [];
			const failed: Array<{ id: string; error: string }> = [];
			let scanned = 0;

			// Re-embedding boundary (I3) is lazy — only built when --fix --mode=redact.
			let embedChain: ReturnType<typeof buildEmbeddingChain> | null = null;

			for await (const batch of entryRepo.iterateAll(batchSize)) {
				for (const entry of batch) {
					scanned += 1;
					const f = auditEntry(entry);
					if (!f) continue;
					findings.push(f);
					if (!fix) continue;
					try {
						if (mode === "redact") {
							const patch = planRedactPatch(entry);
							if (!patch) continue;
							let embedding: number[] | undefined;
							if (patch.embeddingText !== undefined) {
								embedChain ??= buildEmbeddingChain();
								const result = await embedChain.embed(patch.embeddingText);
								embedding = result.vector;
							}
							await entryRepo.updateRedactedFields(entry.id, {
								title: patch.title,
								summary: patch.summary,
								details: patch.details,
								embeddingText: patch.embeddingText,
								embedding,
							});
							redacted.push({
								id: entry.id,
								patterns: patch.patternsHit,
								fields: f.findings.flatMap((x) => x.fields),
							});
							// Audit-event placeholder — IV1 will replace with structured event.
							logger.warn(
								{
									event: "secret_audit_redact",
									entryId: entry.id,
									patterns: patch.patternsHit,
								},
								"audit: redacted secret in memory entry",
							);
						} else if (mode === "archive") {
							const plan = planArchiveTransitions(entry.trust.status);
							for (const step of plan) {
								await entryRepo.transitionStatus(
									entry.id,
									step.to,
									`secret audit (III1): archive ${f.findings.map((x) => x.pattern).join(",")}`,
									"cli:audit-secrets",
								);
							}
							archived.push({ id: entry.id, transitions: plan });
							logger.warn(
								{
									event: "secret_audit_archive",
									entryId: entry.id,
									from: entry.trust.status,
									steps: plan.length,
								},
								"audit: archived memory entry with secret findings",
							);
						}
					} catch (err) {
						const msg = err instanceof Error ? err.message : String(err);
						failed.push({ id: entry.id, error: msg });
					}
				}
			}

			const report = {
				catalog_version: CATALOG_VERSION,
				scanned,
				matched: findings.length,
				entries: findings,
				...(fix
					? {
							mode,
							...(mode === "redact" ? { redacted } : { archived }),
							failed,
						}
					: {}),
			};
			console.log(JSON.stringify(report, null, 2));
			await closeDb();
			process.exit(failed.length > 0 ? 1 : 0);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			console.error(JSON.stringify({ error: message }, null, 2));
			await closeDb();
			process.exit(1);
		}
	});

function buildQuarantineService(): QuarantineService {
	const sql = getDb();
	const entryRepo = new MemoryEntryRepository(sql);
	const evidenceRepo = new EvidenceRepository(sql);
	const contradictionRepo = new ContradictionRepository(sql);
	const repoRoot = process.env.REPO_ROOT ?? process.cwd();
	const validators = [
		new FileExistsValidator(repoRoot),
		new SymbolExistsValidator(repoRoot),
		new DiffImpactValidator(repoRoot),
		new TestLinkedValidator(repoRoot),
	];
	return new QuarantineService(entryRepo, evidenceRepo, contradictionRepo, validators);
}

function buildPromotionService(): PromotionService {
	const sql = getDb();
	const entryRepo = new MemoryEntryRepository(sql);
	const eventRepo = new MemoryEventRepository(sql);
	const quarantine = buildQuarantineService();
	return new PromotionService(sql, entryRepo, quarantine, eventRepo);
}

function parseLevel(input: string): DisclosureLevel {
	const normalized = input.toLowerCase();
	if (normalized === "l1" || normalized === "1" || normalized === "index") return "index";
	if (normalized === "l2" || normalized === "2" || normalized === "timeline") return "timeline";
	if (normalized === "l3" || normalized === "3" || normalized === "full") return "full";
	throw new Error(`Invalid layer: ${input}. Expected 1|2|3 or L1|L2|L3 or index|timeline|full.`);
}

async function probeHealth(timeoutMs: number): Promise<HealthResponseV1> {
	const start = Date.now();
	try {
		getDb();
		const result = await Promise.race([
			healthCheck(),
			new Promise<{ ok: false; latencyMs: number }>((resolve) =>
				setTimeout(() => resolve({ ok: false, latencyMs: timeoutMs }), timeoutMs),
			),
		]);
		return {
			contract_version: CONTRACT_VERSION,
			status: result.ok ? "ok" : "error",
			backend_version: BACKEND_VERSION,
			features: [...BACKEND_FEATURES],
			latency_ms: result.latencyMs,
		};
	} catch {
		return {
			contract_version: CONTRACT_VERSION,
			status: "error",
			backend_version: BACKEND_VERSION,
			features: [...BACKEND_FEATURES],
			latency_ms: Date.now() - start,
			counts: { error: 1 },
		};
	}
}

// `memory migrate` carries three subcommands plus a backwards-compatible
// default action — existing consumers calling `memory migrate` keep getting
// the apply-pending behavior.
async function runMigrateUp(): Promise<void> {
	try {
		const { runMigrations } = await import("../db/migrate.js");
		const result = await runMigrations();
		console.log(JSON.stringify({ status: "ok", ...result }, null, 2));
		await closeDb();
		process.exit(0);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		console.error(JSON.stringify({ status: "error", error: message }, null, 2));
		await closeDb();
		process.exit(1);
	}
}

async function runMigrateStatus(): Promise<void> {
	try {
		const { buildMigrationStatus } = await import("../db/migrate.js");
		const status = await buildMigrationStatus();
		console.log(JSON.stringify({ status: "ok", ...status }, null, 2));
		await closeDb();
		process.exit(0);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		console.error(JSON.stringify({ status: "error", error: message }, null, 2));
		await closeDb();
		process.exit(1);
	}
}

const migrateCmd = program
	.command("migrate")
	.description(
		"Database migrations — `up` (default) applies pending, `status` prints applied/pending as JSON",
	)
	.action(() => runMigrateUp());

migrateCmd
	.command("up")
	.description("Apply every pending migration — safe to run repeatedly")
	.action(() => runMigrateUp());

migrateCmd
	.command("status")
	.description("Report applied vs. pending migrations (JSON)")
	.action(() => runMigrateStatus());

program
	.command("init")
	.description(
		"Bootstrap a consumer project: docker-compose.agent-memory.yml, .env.agent-memory, .gitignore marker",
	)
	.option("--yes", "Non-interactive mode (assume yes to prompts)", false)
	.option("--force", "Overwrite existing files instead of skipping", false)
	.action(async (options) => {
		try {
			const { runInit, renderInitSummary } = await import("./init.js");
			const report = await runInit({ force: options.force === true });
			// Human summary → stderr; JSON report → stdout (machine-friendly).
			process.stderr.write(`${renderInitSummary(report)}\n`);
			console.log(JSON.stringify(report, null, 2));
			process.exit(0);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			console.error(JSON.stringify({ status: "error", error: message }, null, 2));
			process.exit(1);
		}
	});

program
	.command("doctor")
	.description("Diagnose environment: DATABASE_URL, pgvector, migrations, agent-config")
	.option("--json", "Emit JSON only (no human summary on stderr)", false)
	.option("--fix", "Auto-repair pgvector + pending migrations, then re-diagnose", false)
	.action(async (options) => {
		const { runDoctor, renderHuman } = await import("./doctor.js");
		try {
			const report = await runDoctor({ fix: options.fix === true });
			// Human summary → stderr (always, unless --json); JSON → stdout.
			if (!options.json) {
				process.stderr.write(`${renderHuman(report)}\n`);
			}
			console.log(JSON.stringify(report, null, 2));
			process.exit(report.status === "unhealthy" ? 1 : 0);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			console.error(JSON.stringify({ error: message }, null, 2));
			process.exit(1);
		}
	});

program
	.command("serve")
	.description(
		"Long-running supervisor for container deployments — runs migrations, then idles until SIGTERM (see ADR-0002)",
	)
	.action(async () => {
		// Supervisor mode: logs belong on stderr; stdout stays quiet for
		// operators tailing container output.
		process.env.LOG_LEVEL = process.env.LOG_LEVEL ?? "info";
		const { runMigrations, listPendingMigrations } = await import("../db/migrate.js");
		const { logger } = await import("../utils/logger.js");
		const { enableMetrics } = await import("../observability/metrics.js");
		const { startServeHttp } = await import("./serve-http.js");

		// A2 · runtime-trust. Metrics are opt-in so lean CLI invocations don't
		// pay the registry cost. Initialising eagerly means the first scrape
		// returns every declared metric (including zero-value counters).
		const metricsOn = process.env.MEMORY_METRICS_ENABLED === "true";
		if (metricsOn) enableMetrics();

		try {
			const result = await runMigrations();
			logger.info(
				{ applied: result.applied, skipped: result.skipped.length },
				"serve: migrations up-to-date",
			);
		} catch (err) {
			logger.error({ err }, "serve: migrations failed — continuing, retry with 'memory migrate'");
		}

		// HTTP surface (A1 · runtime-trust). Opt-in via MEMORY_HTTP_PORT.
		// Unset / empty → supervisor runs socket-free (pre-A1 behavior).
		let httpHandle: { close: () => Promise<void> } | null = null;
		const httpPort = parseServePort(process.env.MEMORY_HTTP_PORT);
		if (httpPort != null) {
			try {
				httpHandle = await startServeHttp({
					port: httpPort,
					checkHealth: () => healthCheck(),
					listPending: () => listPendingMigrations(),
					metricsEnabled: metricsOn,
				});
				logger.info(
					{ port: httpPort, metrics: metricsOn },
					metricsOn
						? "serve: http endpoints listening — /health /ready /metrics"
						: "serve: http endpoints listening — /health /ready",
				);
			} catch (err) {
				logger.error(
					{ err, port: httpPort },
					"serve: http listener failed — continuing without /health /ready",
				);
			}
		}

		// Keep the event loop alive. Without an active handle, Node would
		// detect the unsettled top-level await below and exit immediately
		// (`Detected unsettled top-level await` warning). A long-period
		// no-op interval is the cheapest way to park a supervisor process
		// without a scheduler or network listener.
		const keepAlive = setInterval(() => {}, 1 << 30);

		const shutdown = async (signal: NodeJS.Signals) => {
			clearInterval(keepAlive);
			logger.info({ signal }, "serve: shutting down");
			if (httpHandle) {
				try {
					await httpHandle.close();
				} catch (err) {
					logger.warn({ err }, "serve: error closing http listener");
				}
			}
			try {
				await closeDb();
			} catch (err) {
				logger.warn({ err }, "serve: error closing database pool");
			}
			process.exit(0);
		};
		process.on("SIGTERM", () => void shutdown("SIGTERM"));
		process.on("SIGINT", () => void shutdown("SIGINT"));

		logger.info("serve: supervisor ready — awaiting SIGTERM");
		// Park forever. When in-process timers land (ADR-0002 non-goal)
		// the keepAlive interval becomes the scheduler tick.
		await new Promise<void>(() => {});
	});

/**
 * Parse MEMORY_HTTP_PORT into a listening port or null. Empty / unset → null
 * (HTTP surface disabled). Non-numeric, out-of-range, or zero → null with
 * the raw value preserved in the log for debugging.
 */
export function parseServePort(raw: string | undefined): number | null {
	if (raw == null) return null;
	const trimmed = raw.trim();
	if (trimmed === "") return null;
	const n = Number.parseInt(trimmed, 10);
	if (!Number.isFinite(n) || n < 1 || n > 65535) return null;
	return n;
}

program
	.command("mcp")
	.description("Start the MCP stdio server (for agent clients)")
	.action(async () => {
		// Logs go to stderr; the MCP handshake owns stdout.
		process.env.LOG_LEVEL = process.env.LOG_LEVEL ?? "info";
		const { startMcpServer } = await import("../mcp/server.js");
		try {
			await startMcpServer();
		} catch (err) {
			console.error("Fatal error:", err);
			process.exit(1);
		}
	});

// Only parse argv when invoked as a script. The generator in
// scripts/generate-cli-docs.ts imports `program` to introspect commands.
// isMainModule resolves symlinks so `/usr/local/bin/memory` in the
// Docker image (symlinked to /app/dist/cli/index.js) also triggers.
if (isMainModule(import.meta.url)) {
	program.parse();
}

export { program };
