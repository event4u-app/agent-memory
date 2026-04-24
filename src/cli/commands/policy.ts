// C2 · runtime-trust — `memory policy check` CLI.
//
// Exit codes:
//   0 — all configured policies passed
//   1 — at least one policy violated
//   2 — runtime error (DB unreachable, invalid YAML, etc.)
//
// JSON report on stdout, human summary on stderr when `--format human`
// is requested. The contract is `policy-check-v1`; see
// `tests/fixtures/retrieval/policy-check-v1.schema.json`.

import type { Command } from "commander";

import { config } from "../../config.js";
import { type PolicyCheckReport, runPolicyCheck } from "../../quality/policy-check.service.js";
import { createPolicyFetchers } from "../../quality/policy-check-fetchers.js";
import { closeDb, getDb } from "../context.js";

function renderHuman(report: PolicyCheckReport): string {
	const lines: string[] = [];
	const icon = report.status === "pass" ? "✅" : "❌";
	lines.push(`${icon}  memory policy check — ${report.status.toUpperCase()}`);
	if (report.repository) lines.push(`   repository: ${report.repository}`);
	if (report.policies_evaluated.length === 0) {
		lines.push("   no policies configured — add a `policies:` block to .agent-memory.yml.");
		return lines.join("\n");
	}
	lines.push(
		`   evaluated ${report.policies_evaluated.length} · violations ${report.summary.violations} · policies_failed ${report.summary.policies_failed}`,
	);
	for (const v of report.violations) {
		lines.push(
			`   • [${v.policy}] ${v.entry_title} (id=${v.entry_id}, trust=${v.trust_score.toFixed(2)}) — ${v.message}`,
		);
	}
	return lines.join("\n");
}

export function register(program: Command): void {
	const policy = program
		.command("policy")
		.description("Project policy engine (C2) — gate PRs on memory-state violations.");

	policy
		.command("check")
		.description("Evaluate .agent-memory.yml policies against current memory state.")
		.option("--format <fmt>", "Output format: json (default) or human.", "json")
		.action(async (options: { format?: string }) => {
			try {
				const sql = getDb();
				const fetchers = createPolicyFetchers(sql);
				const report = await runPolicyCheck({
					fetchers,
					policies: config.policies,
					repository: config.repository,
				});
				const format = (options.format ?? "json").toLowerCase();
				if (format === "human") {
					process.stderr.write(`${renderHuman(report)}\n`);
				} else {
					process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
				}
				await closeDb();
				process.exit(report.status === "fail" ? 1 : 0);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				process.stderr.write(
					`${JSON.stringify({ error: message, contract_version: "policy-check-v1" }, null, 2)}\n`,
				);
				await closeDb();
				process.exit(2);
			}
		});
}
