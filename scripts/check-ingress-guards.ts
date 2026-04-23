/**
 * Ingress-guard drift check (roadmap IV4).
 *
 * Bi-directional guard:
 *   1. Every entry in `INGRESS_INVENTORY` must reference a file that
 *      exists and contains a direct call to its declared guard symbol
 *      (`enforceNoSecrets` or `secureEmbeddingInput`).
 *   2. Every file in `src/` (outside `GUARD_DEFINITION_FILES`) that
 *      contains a call to one of the guard symbols must have at
 *      least one inventory entry pointing to it — otherwise the
 *      file is an undocumented ingress path.
 *
 * Run with `npm run check:ingress-guards`. CI runs the same command.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import {
	GUARD_DEFINITION_FILES,
	INGRESS_INVENTORY,
	type IngressGuardSymbol,
} from "../src/security/ingress-inventory.js";

const ROOT = path.resolve(process.cwd(), "src");
const GUARDS: IngressGuardSymbol[] = ["enforceNoSecrets", "secureEmbeddingInput"];

interface Issue {
	kind: "missing-call" | "undeclared-ingress" | "missing-file";
	message: string;
}

function walk(dir: string): string[] {
	const out: string[] = [];
	for (const entry of readdirSync(dir)) {
		const full = path.join(dir, entry);
		const st = statSync(full);
		if (st.isDirectory()) out.push(...walk(full));
		else if (full.endsWith(".ts")) out.push(full);
	}
	return out;
}

/**
 * Naive call-site detector: strip `//` line comments and look for
 * `<guard>(` as a substring. Import statements are ignored because
 * they do not contain a trailing `(`. Block comments are ignored by
 * looking only at lines not starting with ` *`.
 */
export function containsCall(source: string, symbol: string): boolean {
	const needle = `${symbol}(`;
	for (const raw of source.split("\n")) {
		const trimmed = raw.trim();
		if (trimmed.startsWith("//") || trimmed.startsWith("*")) continue;
		if (raw.includes(needle)) return true;
	}
	return false;
}

export function findGuardCallsInRepo(files: string[]): Map<string, Set<string>> {
	const map = new Map<string, Set<string>>();
	for (const file of files) {
		const rel = path.relative(process.cwd(), file).split(path.sep).join("/");
		if (GUARD_DEFINITION_FILES.has(rel)) continue;
		const src = readFileSync(file, "utf8");
		for (const g of GUARDS) {
			if (containsCall(src, g)) {
				if (!map.has(rel)) map.set(rel, new Set());
				map.get(rel)?.add(g);
			}
		}
	}
	return map;
}

export function auditInventory(calls: Map<string, Set<string>>): Issue[] {
	const issues: Issue[] = [];
	const declaredFiles = new Set(INGRESS_INVENTORY.map((p) => p.file));

	for (const entry of INGRESS_INVENTORY) {
		const abs = path.resolve(process.cwd(), entry.file);
		if (!existsSync(abs)) {
			issues.push({
				kind: "missing-file",
				message: `${entry.file} (${entry.symbol}) is in the inventory but does not exist on disk.`,
			});
			continue;
		}
		const src = readFileSync(abs, "utf8");
		if (!containsCall(src, entry.guard)) {
			issues.push({
				kind: "missing-call",
				message: `${entry.file} :: ${entry.symbol} must call \`${entry.guard}\` — no call site found.`,
			});
		}
	}

	for (const [file, guards] of calls) {
		if (declaredFiles.has(file)) continue;
		const g = [...guards].join(", ");
		issues.push({
			kind: "undeclared-ingress",
			message: `${file} calls ${g} but is not in INGRESS_INVENTORY — every ingress path must be declared.`,
		});
	}

	return issues;
}

function main(): void {
	const files = walk(ROOT);
	const calls = findGuardCallsInRepo(files);
	const issues = auditInventory(calls);

	if (issues.length === 0) {
		// biome-ignore lint/suspicious/noConsole: CLI diagnostic
		console.log(
			`✅  ingress-guards: inventory and call sites in sync — ${INGRESS_INVENTORY.length} declared, ${calls.size} files with guard calls.`,
		);
		return;
	}

	// biome-ignore lint/suspicious/noConsole: CLI diagnostic
	console.error(`❌  ingress-guards: ${issues.length} drift issue(s):`);
	for (const i of issues) {
		// biome-ignore lint/suspicious/noConsole: CLI diagnostic
		console.error(`   [${i.kind}]  ${i.message}`);
	}
	// biome-ignore lint/suspicious/noConsole: CLI diagnostic
	console.error(
		`\nEvery ingress path must be declared in src/security/ingress-inventory.ts and call its guard.\nSee agents/roadmaps/secret-safety.md (IV4).`,
	);
	process.exit(1);
}

// Only run when executed directly — tests import the audit helper.
if (import.meta.url === `file://${process.argv[1]}`) {
	main();
}
