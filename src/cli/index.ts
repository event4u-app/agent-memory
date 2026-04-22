#!/usr/bin/env node
// Default to silent logger for CLI usage unless caller overrides.
// Must happen before any import that touches the logger (config/db).
process.env.LOG_LEVEL ??= "silent";

import { Command } from "commander";
import { closeDb, getDb, healthCheck } from "../db/connection.js";
import { ContradictionRepository } from "../db/repositories/contradiction.repository.js";
import { EvidenceRepository } from "../db/repositories/evidence.repository.js";
import { MemoryEntryRepository } from "../db/repositories/memory-entry.repository.js";
import {
	BACKEND_FEATURES,
	CONTRACT_VERSION,
	type HealthResponseV1,
} from "../retrieval/contract.js";
import { PromotionService } from "../trust/promotion.service.js";
import { QuarantineService } from "../trust/quarantine.service.js";
import { DiffImpactValidator } from "../trust/validators/diff-impact.validator.js";
import { FileExistsValidator } from "../trust/validators/file-exists.validator.js";
import { SymbolExistsValidator } from "../trust/validators/symbol-exists.validator.js";
import { TestLinkedValidator } from "../trust/validators/test-linked.validator.js";
import type { ImpactLevel, KnowledgeClass, MemoryType } from "../types.js";

const BACKEND_VERSION = "0.1.0";
const HEALTH_TIMEOUT_MS = 2000;

const collect = (value: string, previous: string[]): string[] => [
	...previous,
	value,
];

const program = new Command();

program
	.name("memory")
	.description("Agent Memory — persistent, trust-scored project knowledge")
	.version(BACKEND_VERSION);

program
	.command("ingest")
	.description("Ingest knowledge from a repository or diff")
	.argument("[path]", "Path to repository or file", ".")
	.option("--from-diff <range>", "Extract from git diff (e.g., HEAD~1..HEAD)")
	.option("--dry-run", "Show what would be ingested without storing")
	.action(async (path, options) => {
		console.log("🔍 memory ingest — not yet implemented");
		console.log({ path, ...options });
	});

program
	.command("retrieve")
	.description("Query memory for relevant knowledge")
	.argument("<query>", "Natural language query")
	.option("--layer <n>", "Disclosure layer: 1=index, 2=timeline, 3=full", "1")
	.option("--budget <tokens>", "Max token budget", "2000")
	.option("--low-trust", "Include low-trust entries (⚠️ marker)")
	.option("--type <type>", "Filter by memory type")
	.option("--module <module>", "Filter by module")
	.action(async (query, options) => {
		console.log("🔍 memory retrieve — not yet implemented");
		console.log({ query, ...options });
	});

program
	.command("validate")
	.description("Validate a specific memory entry against current code")
	.argument("<id>", "Memory entry ID")
	.action(async (id) => {
		console.log("✅ memory validate — not yet implemented");
		console.log({ id });
	});

program
	.command("invalidate")
	.description("Mark entries as stale or invalidated")
	.option(
		"--from-git-diff",
		"Invalidate entries affected by recent git changes",
	)
	.option("--entry <id>", "Invalidate a specific entry")
	.option("--hard", "Hard invalidation (entry is completely wrong)")
	.action(async (options) => {
		console.log("❌ memory invalidate — not yet implemented");
		console.log(options);
	});

program
	.command("poison")
	.description("Mark an entry as confirmed wrong — triggers cascade review")
	.argument("<id>", "Memory entry ID")
	.argument("<reason>", "Why this entry is wrong")
	.action(async (id, reason) => {
		console.log("☠️ memory poison — not yet implemented");
		console.log({ id, reason });
	});

program
	.command("verify")
	.description("Trace a memory entry back to its source evidence")
	.argument("<id>", "Memory entry ID")
	.action(async (id) => {
		console.log("🔗 memory verify — not yet implemented");
		console.log({ id });
	});

program
	.command("propose")
	.description(
		"Propose a new memory entry (lands in quarantine; not served until promoted)",
	)
	.requiredOption("--type <type>", "Memory type (e.g., architecture_decision)")
	.requiredOption("--title <title>", "Short title")
	.requiredOption("--summary <summary>", "One-paragraph summary")
	.option("--details <details>", "Optional long-form details")
	.requiredOption("--repository <repository>", "Repository identifier")
	.option("--file <path>", "File in scope (repeatable)", collect, [])
	.option("--symbol <symbol>", "Symbol in scope (repeatable)", collect, [])
	.option("--module <module>", "Module in scope (repeatable)", collect, [])
	.option(
		"--impact <level>",
		"Impact level (critical|high|normal|low)",
		"normal",
	)
	.option(
		"--knowledge-class <class>",
		"Knowledge class (evergreen|semi_stable|volatile)",
		"semi_stable",
	)
	.requiredOption("--source <source>", "Source ref (incident id, PR, ADR)")
	.requiredOption("--confidence <n>", "Initial confidence 0.0–1.0", "0.6")
	.option(
		"--scenario <text>",
		"Future scenario (repeat 3+ times for non-low impact)",
		collect,
		[],
	)
	.option(
		"--gate-clean",
		"Assert extraction-guard was clean at proposal time",
		false,
	)
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
				futureScenarios:
					options.scenario.length > 0 ? options.scenario : undefined,
				gateCleanAtProposal,
			});
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
	.command("promote")
	.description("Promote a quarantined proposal through gate criteria")
	.argument("<proposal-id>", "Proposal ID returned by `propose`")
	.option(
		"--allowed-type <type>",
		"Allowed target type (repeatable; consumer policy)",
		collect,
		[],
	)
	.option(
		"--skip-duplicate-check",
		"Skip non-duplication gate (caller accepts the sibling)",
		false,
	)
	.option("--triggered-by <actor>", "Caller identifier", "cli:promote")
	.action(async (proposalId, options) => {
		try {
			const service = buildPromotionService();
			const result = await service.promote(proposalId, {
				triggeredBy: options.triggeredBy,
				allowedTargetTypes:
					options.allowedType.length > 0
						? (options.allowedType as MemoryType[])
						: undefined,
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
	.description(
		"Feature detection for consumers — prints present | absent | misconfigured",
	)
	.option("--timeout <ms>", "Timeout in ms", String(HEALTH_TIMEOUT_MS))
	.option("--json", "Emit full JSON envelope (always exits 0)")
	.action(async (options) => {
		const timeoutMs = Number.parseInt(options.timeout, 10) || HEALTH_TIMEOUT_MS;
		const envelope = await probeHealth(timeoutMs);
		const memoryStatus: "present" | "absent" | "misconfigured" =
			envelope.status === "ok" ? "present" : "misconfigured";
		if (options.json) {
			console.log(
				JSON.stringify({ memory_status: memoryStatus, ...envelope }, null, 2),
			);
		} else {
			console.log(memoryStatus);
		}
		await closeDb();
		process.exit(0);
	});

program
	.command("diagnose")
	.description("Identify issues: stale entries, contradictions, low trust")
	.action(async () => {
		console.log("🩺 memory diagnose — not yet implemented");
	});

function buildPromotionService(): PromotionService {
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
	const quarantine = new QuarantineService(
		entryRepo,
		evidenceRepo,
		contradictionRepo,
		validators,
	);
	return new PromotionService(sql, entryRepo, quarantine);
}

async function probeHealth(timeoutMs: number): Promise<HealthResponseV1> {
	const start = Date.now();
	try {
		getDb();
		const result = await Promise.race([
			healthCheck(),
			new Promise<{ ok: false; latencyMs: number }>((resolve) =>
				setTimeout(
					() => resolve({ ok: false, latencyMs: timeoutMs }),
					timeoutMs,
				),
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

program.parse();
