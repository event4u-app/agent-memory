/**
 * Minimal Node example — one propose + one retrieve.
 *
 * Demonstrates the two supported programmatic patterns side-by-side:
 *   1. Shell-out to the CLI (recommended for full contract coverage).
 *   2. Direct repository access (advanced; bypasses CLI's validators).
 *
 * Run with:
 *   cp .env.example .env && export $(grep -v '^#' .env | xargs)
 *   npm install
 *   npm start
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";

import {
	closeDb,
	type CreateEntryInput,
	getDb,
	MemoryEntryRepository,
} from "@event4u/agent-memory";

const run = promisify(execFile);
const REPO = "node-programmatic-example";

async function proposeViaCli(): Promise<string> {
	const { stdout } = await run("npx", [
		"memory",
		"ingest",
		"--type",
		"architecture_decision",
		"--title",
		"Use ESM throughout the worker pipeline",
		"--summary",
		"All worker tasks resolve import paths via NodeNext to avoid CJS interop bugs.",
		"--repository",
		REPO,
	]);
	const parsed = JSON.parse(stdout) as { id: string; status: string };
	console.log(`  ✓ CLI ingest → id=${parsed.id} status=${parsed.status}`);
	return parsed.id;
}

async function retrieveViaCli(): Promise<void> {
	const { stdout } = await run("npx", [
		"memory",
		"retrieve",
		"how do we handle module resolution?",
		"--limit",
		"3",
		"--low-trust",
	]);
	const result = JSON.parse(stdout) as {
		entries: Array<{ id: string; title: string; trust_score: number }>;
	};
	console.log(`  ✓ CLI retrieve → ${result.entries.length} entries`);
	for (const entry of result.entries) {
		console.log(
			`      ${entry.id.slice(0, 8)}  trust=${entry.trust_score.toFixed(2)}  ${entry.title}`,
		);
	}
}

async function proposeViaRepository(): Promise<void> {
	const sql = getDb();
	const repo = new MemoryEntryRepository(sql);

	const input: CreateEntryInput = {
		type: "coding_convention",
		title: "All public functions end with a return type annotation",
		summary: "Strict return annotations keep tsc --noEmit honest in this codebase.",
		scope: {
			repository: REPO,
			files: [],
			symbols: [],
			modules: [],
		},
		impactLevel: "normal",
		knowledgeClass: "evergreen",
		embeddingText: "return type annotation strict typescript conventions",
		createdBy: "example:node-programmatic",
	};

	const entry = await repo.create(input);
	console.log(
		`  ✓ Repository create → id=${entry.id.slice(0, 8)}  status=${entry.trust.status}`,
	);

	await closeDb();
}

async function main(): Promise<void> {
	console.log("=== 1. Propose via CLI (happy path) ===");
	await proposeViaCli();

	console.log("\n=== 2. Retrieve via CLI ===");
	await retrieveViaCli();

	console.log("\n=== 3. Propose via repository (advanced) ===");
	await proposeViaRepository();

	console.log("\nDone.");
}

main().catch((err: unknown) => {
	console.error("Example failed:", err);
	process.exit(1);
});
