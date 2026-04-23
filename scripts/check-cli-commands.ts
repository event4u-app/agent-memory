/**
 * CLI command-count guard (P6-3).
 *
 * Source of truth: `program.commands` from `src/cli/index.ts`.
 *
 * This script fails if:
 *   - the count written in README (`### CLI commands (N)`) is wrong, or
 *   - any subcommand is missing from the README's backtick list, or
 *   - the README lists a name that no longer exists in the program.
 *
 * Run with `npm run check:cli-commands`.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { program } from "../src/cli/index.js";

const README_PATH = resolve(process.cwd(), "README.md");
const HEADING = /^### CLI commands \((\d+)\)\s*$/m;

function fail(message: string): never {
	// biome-ignore lint/suspicious/noConsole: CLI diagnostic
	console.error(`❌  ${message}`);
	process.exit(1);
}

function extractNames(readme: string): Set<string> {
	const match = readme.match(HEADING);
	if (!match || match.index === undefined) {
		fail("README is missing the `### CLI commands (N)` heading.");
	}
	const after = readme.slice(match.index);
	const end = after.search(/\n##\s|\nFull reference:/);
	const block = end === -1 ? after : after.slice(0, end);
	const names = new Set<string>();
	const re = /`([a-z-]+)`/g;
	let m: RegExpExecArray | null;
	// biome-ignore lint/suspicious/noAssignInExpressions: standard regex loop
	while ((m = re.exec(block)) !== null) names.add(m[1]);
	return names;
}

function main(): void {
	const readme = readFileSync(README_PATH, "utf8");
	const heading = readme.match(HEADING);
	if (!heading) fail("README is missing the `### CLI commands (N)` heading.");
	const claimedCount = Number(heading[1]);

	const registered = new Set(program.commands.map((c) => c.name()));
	const documented = extractNames(readme);

	const missingFromReadme = [...registered].filter((n) => !documented.has(n));
	const strayInReadme = [...documented].filter((n) => !registered.has(n));

	const errors: string[] = [];
	if (claimedCount !== registered.size) {
		errors.push(
			`README claims "CLI commands (${claimedCount})" but ${registered.size} commands are registered.`,
		);
	}
	if (missingFromReadme.length > 0) {
		errors.push(
			`Commands registered but missing from README: ${missingFromReadme.join(", ")}`,
		);
	}
	if (strayInReadme.length > 0) {
		errors.push(
			`Commands listed in README but not registered: ${strayInReadme.join(", ")}`,
		);
	}

	if (errors.length > 0) {
		for (const err of errors) {
			// biome-ignore lint/suspicious/noConsole: CLI diagnostic
			console.error(`❌  ${err}`);
		}
		// biome-ignore lint/suspicious/noConsole: CLI hint
		console.error(
			"\nFix the README `### CLI commands (N)` section to match src/cli/index.ts.",
		);
		process.exit(1);
	}

	// biome-ignore lint/suspicious/noConsole: CLI diagnostic
	console.log(
		`✅  CLI command-count guard: ${registered.size} commands registered, all listed in README.`,
	);
}

main();
