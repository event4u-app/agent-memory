// B3 · runtime-trust — `memory contradictions` drill-down CLI.
// Lists open contradictions; `--repository` narrows to a single repo
// scope, `--since` to a recent window. Previously only reachable as
// a side-view of `memory diagnose` / `memory review`.

import type { Command } from "commander";
import { fetchContradictions } from "../../quality/review-fetchers.js";
import { closeDb, getDb } from "../context.js";

function parseSince(raw: string | undefined): Date | undefined {
	if (!raw) return undefined;
	const d = new Date(raw);
	if (Number.isNaN(d.getTime())) {
		throw new Error(`--since: not an ISO-8601 timestamp: ${raw}`);
	}
	return d;
}

export function register(program: Command): void {
	program
		.command("contradictions")
		.description("List unresolved memory contradictions (B3 · runtime-trust)")
		.option("--repository <repo>", "Filter to entries whose scope.repository matches")
		.option("--since <ts>", "ISO-8601 timestamp — only contradictions created at or after")
		.option("--limit <n>", "Max rows to return", "50")
		.option("--json", "Emit JSON list instead of human output")
		.action(
			async (options: { repository?: string; since?: string; limit: string; json?: boolean }) => {
				try {
					const since = parseSince(options.since);
					const limit = Number.parseInt(options.limit, 10);
					if (!Number.isFinite(limit) || limit <= 0) {
						throw new Error(`--limit: expected a positive integer, got ${options.limit}`);
					}
					const sql = getDb();
					const rows = await fetchContradictions(sql, {
						repository: options.repository,
						since,
						limit,
					});
					if (options.json) {
						console.log(
							JSON.stringify(
								{
									count: rows.length,
									filter: {
										repository: options.repository ?? null,
										since: since?.toISOString() ?? null,
										limit,
									},
									contradictions: rows.map((r) => ({
										id: r.id,
										entry_a: { id: r.entryAId, title: r.entryATitle },
										entry_b: { id: r.entryBId, title: r.entryBTitle },
										description: r.description,
										created_at: r.createdAt.toISOString(),
									})),
								},
								null,
								2,
							),
						);
					} else if (rows.length === 0) {
						console.log("No unresolved contradictions.");
					} else {
						for (const r of rows) {
							console.log(`\n${r.id}  ${r.createdAt.toISOString()}`);
							console.log(`  ${r.description}`);
							console.log(`  A: ${r.entryAId}  ${r.entryATitle}`);
							console.log(`  B: ${r.entryBId}  ${r.entryBTitle}`);
						}
						console.log(`\n${rows.length} unresolved contradiction(s).`);
					}
					await closeDb();
					process.exit(0);
				} catch (error) {
					const message = error instanceof Error ? error.message : String(error);
					console.error(JSON.stringify({ error: message }));
					await closeDb();
					process.exit(1);
				}
			},
		);
}
