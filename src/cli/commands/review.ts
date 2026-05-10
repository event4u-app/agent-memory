// B3 · runtime-trust — `memory review` CLI.
// Modes:
//   (default)                 interactive accept/defer/skip loop over open cases
//   --weekly [--format json]  non-interactive digest (review-weekly-v1 schema)
//   --weekly --format slack-block-kit → Slack Block Kit payload

import readline from "node:readline/promises";
import type { Command } from "commander";
import { ContradictionRepository } from "../../db/repositories/contradiction.repository.js";
import { MemoryEntryRepository } from "../../db/repositories/memory-entry.repository.js";
import { MemoryEventRepository } from "../../db/repositories/memory-event.repository.js";
import {
	buildReviewDigest,
	type ReviewCase,
	type ReviewDigestV1,
} from "../../quality/review.service.js";
import {
	type ApplyActionDeps,
	applyReviewAction,
	DEFER_WINDOW_MINUTES,
	type ReviewDecision,
} from "../../quality/review-actions.js";
import {
	fetchContradictions,
	fetchPoisonCandidates,
	fetchStaleHighValue,
} from "../../quality/review-fetchers.js";
import { toSlackBlockKit } from "../../quality/review-slack.js";
import { closeDb, getDb } from "../context.js";

const CASE_LIMIT_PER_KIND = 25;

async function loadDigest(sql: Parameters<typeof fetchStaleHighValue>[0]): Promise<ReviewDigestV1> {
	const eventRepo = new MemoryEventRepository(sql);
	const [stale, contradictions, poison, deferredIds] = await Promise.all([
		fetchStaleHighValue(sql, CASE_LIMIT_PER_KIND),
		fetchContradictions(sql, { limit: CASE_LIMIT_PER_KIND }),
		fetchPoisonCandidates(sql, CASE_LIMIT_PER_KIND),
		eventRepo.listCaseIdsByTypeSince("review_deferred", DEFER_WINDOW_MINUTES),
	]);
	return buildReviewDigest({
		staleHighValue: stale,
		contradictions,
		poisonCandidates: poison,
		deferredCaseIds: new Set(deferredIds),
	});
}

function renderCaseHeader(c: ReviewCase, index: number, total: number): string {
	const lines = [`\n[${index + 1}/${total}] ${c.kind.replaceAll("_", " ")}  ·  ${c.case_id}`];
	if (c.kind === "stale_high_value") {
		lines.push(
			`  ${c.title}`,
			`  impact=${c.impact_level}  score=${c.trust_score.toFixed(2)}  days_since_validation=${c.days_since_validation}`,
		);
	} else if (c.kind === "contradiction") {
		lines.push(
			`  ${c.description}`,
			`  A: ${c.entry_a.id}  ${c.entry_a.title}`,
			`  B: ${c.entry_b.id}  ${c.entry_b.title}`,
		);
	} else {
		lines.push(
			`  ${c.title}`,
			`  score=${c.trust_score.toFixed(2)}  invalidations(30d)=${c.invalidation_count}`,
		);
	}
	lines.push(`  hint: ${c.hint}`);
	return lines.join("\n");
}

async function promptDecision(rl: readline.Interface): Promise<ReviewDecision | "quit"> {
	const raw = (await rl.question("[a]ccept  [d]efer  [s]kip  [q]uit: ")).trim().toLowerCase();
	if (raw === "a" || raw === "accept") return "accept";
	if (raw === "d" || raw === "defer") return "defer";
	if (raw === "s" || raw === "skip") return "skip";
	return "quit";
}

async function runInteractive(
	sql: Parameters<typeof fetchStaleHighValue>[0],
	actor: string,
): Promise<void> {
	const digest = await loadDigest(sql);
	console.log(
		`Open cases: ${digest.summary.stale_high_value} stale · ${digest.summary.contradictions} contradictions · ${digest.summary.poison_candidates} poison candidates${digest.summary.deferred ? `  (${digest.summary.deferred} deferred)` : ""}`,
	);
	if (digest.cases.length === 0) {
		console.log("Nothing to review — memory-store is clean.");
		return;
	}
	const eventRepo = new MemoryEventRepository(sql);
	const entryRepo = new MemoryEntryRepository(sql, eventRepo);
	const contradictionRepo = new ContradictionRepository(sql);
	const deps: ApplyActionDeps = { entryRepo, contradictionRepo, eventRepo };
	const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
	try {
		for (let i = 0; i < digest.cases.length; i++) {
			const c = digest.cases[i]!;
			console.log(renderCaseHeader(c, i, digest.cases.length));
			const decision = await promptDecision(rl);
			if (decision === "quit") {
				console.log("Aborted — remaining cases untouched.");
				break;
			}
			const result = await applyReviewAction(c, decision, actor, deps);
			console.log(`  → ${result.action_taken}`);
		}
	} finally {
		rl.close();
	}
}

export function register(program: Command): void {
	program
		.command("review")
		.description("Triage open memory cases: accept/defer/skip (B3 · runtime-trust)")
		.option("--weekly", "Non-interactive digest of open cases")
		.option("--format <fmt>", "Output format for --weekly: json | slack-block-kit", "json")
		.option("--actor <actor>", "Audit actor for accept/defer/skip writes", "human:review-cli")
		.action(async (options: { weekly?: boolean; format?: string; actor: string }) => {
			try {
				const sql = getDb();
				if (options.weekly) {
					const digest = await loadDigest(sql);
					if (options.format === "slack-block-kit") {
						console.log(JSON.stringify(toSlackBlockKit(digest), null, 2));
					} else if (options.format === "json" || !options.format) {
						console.log(JSON.stringify(digest, null, 2));
					} else {
						console.error(
							JSON.stringify({
								error: `unknown --format: ${options.format} (expected json|slack-block-kit)`,
							}),
						);
						await closeDb();
						process.exit(1);
						return;
					}
					await closeDb();
					process.exit(0);
					return;
				}
				await runInteractive(sql, options.actor);
				await closeDb();
				process.exit(0);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				console.error(JSON.stringify({ error: message }));
				await closeDb();
				process.exit(1);
			}
		});
}
