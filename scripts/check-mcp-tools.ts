/**
 * MCP tool-count guard (P6-2).
 *
 * Source of truth: the `toolDefinitions` array in
 * `src/mcp/tool-definitions.ts`. Each entry's `name` is the tool's
 * public identifier and must also appear in the README MCP tool table.
 *
 * This script fails if:
 *   - the count written in README (`### MCP tools (N)`) is wrong, or
 *   - any tool name is missing from the README table, or
 *   - the README table lists a name that is no longer registered.
 *
 * Run with `npm run check:mcp-tools`. CI runs the same command.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { TOOL_DEFINITIONS } from "../src/mcp/tool-definitions.js";

const README_PATH = resolve(process.cwd(), "README.md");
const HEADING = /^### MCP tools \((\d+)\)\s*$/m;

function fail(message: string): never {
	// biome-ignore lint/suspicious/noConsole: CLI diagnostic
	console.error(`❌  ${message}`);
	process.exit(1);
}

function extractNamesFromTable(readme: string): Set<string> {
	const match = readme.match(HEADING);
	if (!match || match.index === undefined) {
		fail("README is missing the `### MCP tools (N)` section heading.");
	}
	// Slice from the heading to the next `##` boundary.
	const after = readme.slice(match.index);
	const end = after.search(/\n##\s/);
	const block = end === -1 ? after : after.slice(0, end);
	const names = new Set<string>();
	// Tool names are `memory_*` wrapped in backticks inside the table rows.
	const re = /`(memory_[a-z_]+)`/g;
	let m: RegExpExecArray | null;
	// biome-ignore lint/suspicious/noAssignInExpressions: standard regex loop
	while ((m = re.exec(block)) !== null) names.add(m[1]);
	return names;
}

function main(): void {
	const readme = readFileSync(README_PATH, "utf8");
	const heading = readme.match(HEADING);
	if (!heading) fail("README is missing the `### MCP tools (N)` heading.");
	const claimedCount = Number(heading[1]);

	const registered = new Set(TOOL_DEFINITIONS.map((t) => t.name));
	const documented = extractNamesFromTable(readme);

	const missingFromReadme = [...registered].filter((n) => !documented.has(n));
	const strayInReadme = [...documented].filter((n) => !registered.has(n));

	const errors: string[] = [];
	if (claimedCount !== registered.size) {
		errors.push(
			`README claims "MCP tools (${claimedCount})" but ${registered.size} tools are registered in src/mcp/tool-definitions.ts.`,
		);
	}
	if (missingFromReadme.length > 0) {
		errors.push(
			`Tools registered but missing from README table: ${missingFromReadme.join(", ")}`,
		);
	}
	if (strayInReadme.length > 0) {
		errors.push(
			`Tools listed in README but not registered: ${strayInReadme.join(", ")}`,
		);
	}

	if (errors.length > 0) {
		for (const err of errors) {
			// biome-ignore lint/suspicious/noConsole: CLI diagnostic
			console.error(`❌  ${err}`);
		}
		// biome-ignore lint/suspicious/noConsole: CLI hint
		console.error(
			"\nFix the README `### MCP tools (N)` section to match src/mcp/tool-definitions.ts.",
		);
		process.exit(1);
	}

	// biome-ignore lint/suspicious/noConsole: CLI diagnostic
	console.log(
		`✅  MCP tool-count guard: ${registered.size} tools registered, all listed in README.`,
	);
}

main();
