import type { Command } from "commander";
import { config } from "../../config.js";
import { EvidenceRepository } from "../../db/repositories/evidence.repository.js";
import { MemoryEntryRepository } from "../../db/repositories/memory-entry.repository.js";
import { buildInvalidateGitDiffEnvelope } from "../../invalidation/git-diff-envelope.js";
import { hardInvalidate, softInvalidate } from "../../invalidation/invalidation-flows.js";
import { InvalidationOrchestrator } from "../../invalidation/orchestrator.js";
import { closeDb, getDb } from "../context.js";

export function register(program: Command): void {
	program
		.command("invalidate")
		.description("Mark entries as stale or rejected (soft/hard or git-diff sweep)")
		.option("--entry <id>", "Invalidate a specific entry")
		.option("--hard", "Hard invalidation (entry is completely wrong)")
		.option("--reason <text>", "Reason for invalidation", "cli:invalidate")
		.option(
			"--from-git-diff",
			"Run git-diff invalidation orchestrator (sweeps all affected entries)",
		)
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
					// C3 · wrap in invalidate-git-diff-v1 envelope so the GitHub
					// Action (`event4u-app/agent-memory-action`) can render stable
					// PR comments. Repository scope comes from .agent-memory.yml.
					const envelope = buildInvalidateGitDiffEnvelope({
						result,
						repository: config.repository,
					});
					console.log(JSON.stringify(envelope, null, 2));
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
}
