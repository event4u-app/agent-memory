/**
 * Universality guard extension (P6-4).
 *
 * The existing `check:portability` scanner enforces a repo-wide
 * blocklist for foreign-project leakage. Pure-knowledge docs must be
 * held to a *stricter* standard: they must not mention any specific
 * host language, framework, or package manager at all.
 *
 * Files scanned (only when they exist):
 *   - docs/comparisons.md         — conceptual comparison, no stacks
 *   - docs/glossary.md            — domain terms only
 *   - docs/tutorial-first-memory.md — walkthrough, stack-free
 *
 * Not in this strict list (by design):
 *   - docs/consumer-setup-generic.md, docs/consumer-setup-docker-sidecar.md
 *     These are multi-stack showcases that name stacks equivalently
 *     (parallel code blocks, links to per-stack example dirs). They
 *     are still covered by the broader repo-wide `check:portability`.
 *   - docs/consumer-setup-node.md — explicit Node-specific guide.
 *
 * Run with `npm run check:neutral-docs`.
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const TARGETS = [
	"docs/comparisons.md",
	"docs/glossary.md",
	"docs/tutorial-first-memory.md",
];

// Stack-specific terms that must not appear in neutral docs as prose.
// Each rule is (regex, reason). Case-insensitive; word-boundary-anchored
// where appropriate to avoid false positives ("node" inside "nodejs").
const FORBIDDEN: Array<{ pattern: RegExp; reason: string }> = [
	{ pattern: /\bLaravel\b/i, reason: "PHP framework" },
	{ pattern: /\bEloquent\b/i, reason: "PHP ORM" },
	{ pattern: /\bartisan\b/i, reason: "PHP/Laravel CLI" },
	{ pattern: /\bBlade\b/i, reason: "PHP template engine" },
	{ pattern: /\bLivewire\b/i, reason: "PHP/Laravel component framework" },
	{ pattern: /\bFormRequest\b/i, reason: "Laravel request class" },
	{ pattern: /\bcomposer\b/i, reason: "PHP package manager" },
	{ pattern: /\bPest\b(?!y)/, reason: "PHP test runner" },
	{ pattern: /\bPHPUnit\b/i, reason: "PHP test runner" },
	{ pattern: /\bSymfony\b/i, reason: "PHP framework" },
	{ pattern: /\bDjango\b/i, reason: "Python framework" },
	{ pattern: /\bFlask\b/i, reason: "Python framework" },
	{ pattern: /\bFastAPI\b/i, reason: "Python framework" },
	{ pattern: /\bpip install\b/i, reason: "Python package manager" },
	{ pattern: /\bRails\b/i, reason: "Ruby framework" },
	{ pattern: /\bBundler\b/i, reason: "Ruby package manager" },
	{ pattern: /\bExpress\b/i, reason: "Node framework; belongs in Node guide" },
	{ pattern: /\bNextJS\b|\bNext\.js\b/i, reason: "Node framework" },
	{ pattern: /\bNestJS\b/i, reason: "Node framework" },
	{ pattern: /\bSpring Boot\b/i, reason: "Java framework" },
	{ pattern: /\bGo modules\b/i, reason: "Go-specific; belongs in Go guide" },
];

type Finding = {
	file: string;
	line: number;
	term: string;
	reason: string;
	context: string;
};

function scanFile(path: string): Finding[] {
	const findings: Finding[] = [];
	const content = readFileSync(path, "utf8");
	const lines = content.split("\n");
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		// Skip fenced code blocks — terms there are examples, not prose.
		// Very simple heuristic: skip lines starting with 4 spaces or inside
		// a fence. We'll track fences below.
		for (const rule of FORBIDDEN) {
			const match = line.match(rule.pattern);
			if (match) {
				findings.push({
					file: path,
					line: i + 1,
					term: match[0],
					reason: rule.reason,
					context: line.trim().slice(0, 120),
				});
			}
		}
	}
	// Second pass: remove findings inside fenced code blocks.
	return filterOutFencedBlocks(findings, lines);
}

function filterOutFencedBlocks(findings: Finding[], lines: string[]): Finding[] {
	const inFence = new Set<number>();
	let fenced = false;
	for (let i = 0; i < lines.length; i++) {
		if (/^```/.test(lines[i])) fenced = !fenced;
		else if (fenced) inFence.add(i + 1);
	}
	return findings.filter((f) => !inFence.has(f.line));
}

function main(): void {
	const allFindings: Finding[] = [];
	const scanned: string[] = [];
	for (const rel of TARGETS) {
		const abs = resolve(process.cwd(), rel);
		if (!existsSync(abs)) continue;
		scanned.push(rel);
		allFindings.push(...scanFile(abs));
	}

	if (allFindings.length > 0) {
		// biome-ignore lint/suspicious/noConsole: CLI diagnostic
		console.error(
			`❌  Neutral-docs guard: ${allFindings.length} stack-specific term(s) found.\n`,
		);
		for (const f of allFindings) {
			// biome-ignore lint/suspicious/noConsole: CLI diagnostic
			console.error(
				`   ${f.file}:${f.line}  ${f.term} (${f.reason})\n     ${f.context}`,
			);
		}
		// biome-ignore lint/suspicious/noConsole: CLI hint
		console.error(
			"\nNeutral docs must stay stack-agnostic. Move stack-specific prose to the corresponding consumer-setup-<stack>.md guide, or rewrite generically.",
		);
		process.exit(1);
	}

	// biome-ignore lint/suspicious/noConsole: CLI diagnostic
	console.log(
		`✅  Neutral-docs guard: ${scanned.length} file(s) scanned, no stack-specific terms found.`,
	);
	if (scanned.length < TARGETS.length) {
		const missing = TARGETS.filter((t) => !scanned.includes(t));
		// biome-ignore lint/suspicious/noConsole: CLI diagnostic
		console.log(`   (skipped, not yet created: ${missing.join(", ")})`);
	}
}

main();
