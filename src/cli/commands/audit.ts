import type { Command } from "commander";
import { MemoryEntryRepository } from "../../db/repositories/memory-entry.repository.js";
import { buildEmbeddingChain } from "../../embedding/index.js";
import {
	type AuditEntryFinding,
	auditEntry,
	planArchiveTransitions,
	planRedactPatch,
} from "../../security/secret-audit.js";
import { CATALOG_VERSION } from "../../security/secret-patterns.js";
import { closeDb, getDb } from "../context.js";

export function register(program: Command): void {
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

				const { logger } = await import("../../utils/logger.js");
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
}
