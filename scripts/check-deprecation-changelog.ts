/**
 * Deprecation ↔ CHANGELOG drift guard (D5 · runtime-trust).
 *
 * Contract — matches `docs/deprecation-policy.md`:
 *   - Every schema file under `tests/fixtures/retrieval/` or `schema/`
 *     that contains at least one `"deprecated": true` occurrence MUST
 *     be mentioned by filename (stem without extension) in the first
 *     `## [...]` block of `CHANGELOG.md` (Unreleased or newest release).
 *   - Conversely, any schema filename mentioned there that is NOT
 *     flagged `deprecated: true` in a schema is flagged as noise so
 *     the CHANGELOG does not accumulate stale entries.
 *
 * Exits 0 on clean state, 1 on any mismatch.
 *
 * Run with `npm run check:deprecation-changelog`.
 */

import { readFileSync, readdirSync } from "node:fs";
import { basename, join, resolve } from "node:path";

const ROOT = process.cwd();
const SCHEMA_DIRS = ["tests/fixtures/retrieval", "schema"];
const CHANGELOG_PATH = resolve(ROOT, "CHANGELOG.md");

function log(line: string): void {
	// biome-ignore lint/suspicious/noConsole: CLI diagnostic
	console.log(line);
}

function err(line: string): void {
	// biome-ignore lint/suspicious/noConsole: CLI diagnostic
	console.error(line);
}

/** Recursively probe a parsed JSON schema for any `deprecated: true`. */
function hasDeprecated(node: unknown): boolean {
	if (node === null || typeof node !== "object") return false;
	const obj = node as Record<string, unknown>;
	if (obj.deprecated === true) return true;
	for (const value of Object.values(obj)) {
		if (hasDeprecated(value)) return true;
	}
	return false;
}

function collectDeprecatedSchemas(): string[] {
	const flagged: string[] = [];
	for (const dir of SCHEMA_DIRS) {
		const abs = resolve(ROOT, dir);
		let entries: string[];
		try {
			entries = readdirSync(abs);
		} catch {
			continue;
		}
		for (const entry of entries) {
			if (!entry.endsWith(".schema.json")) continue;
			const full = join(abs, entry);
			let parsed: unknown;
			try {
				parsed = JSON.parse(readFileSync(full, "utf-8"));
			} catch {
				continue;
			}
			if (hasDeprecated(parsed)) {
				flagged.push(basename(entry, ".json"));
			}
		}
	}
	return flagged.sort();
}

function extractTopChangelogBlock(): string {
	const text = readFileSync(CHANGELOG_PATH, "utf-8");
	const headings = [...text.matchAll(/^## \[[^\]]+\]/gm)];
	if (headings.length === 0) return "";
	const first = headings[0]!.index ?? 0;
	const second = headings[1]?.index ?? text.length;
	return text.slice(first, second);
}

function main(): void {
	const flagged = collectDeprecatedSchemas();
	const topBlock = extractTopChangelogBlock();
	const mentioned = new Set<string>();
	for (const f of flagged) {
		if (topBlock.includes(f)) mentioned.add(f);
	}
	const missing = flagged.filter((f) => !mentioned.has(f));

	// Detect stale CHANGELOG references: `*-v{n}.schema` filenames cited
	// in the top block that no schema currently flags as deprecated.
	const cited = new Set<string>();
	const refs = topBlock.matchAll(/[a-z0-9-]+-v\d+\.schema(?=\b|[^a-z])/gi);
	for (const m of refs) cited.add(m[0].toLowerCase());
	const stale = [...cited].filter((c) => !flagged.includes(c));

	if (missing.length === 0 && stale.length === 0) {
		log(
			flagged.length === 0
				? "✅  Deprecation guard: no deprecations flagged. Clean state."
				: `✅  Deprecation guard: ${flagged.length} flagged schema(s) all present in CHANGELOG top block.`,
		);
		return;
	}

	if (missing.length > 0) {
		err("❌  Deprecation guard: flagged schema(s) missing from CHANGELOG.md top block:");
		for (const m of missing) err(`    - ${m}`);
		err(
			"\n    Add an entry under `## [Unreleased]` → `### Deprecated` naming each schema and its removal version.",
		);
	}
	if (stale.length > 0) {
		err(
			"\n❌  Deprecation guard: CHANGELOG top block cites schema(s) that carry no `deprecated: true` flag:",
		);
		for (const s of stale) err(`    - ${s}`);
		err(
			"\n    Either mark the schema deprecated (docs/deprecation-policy.md) or remove the stale CHANGELOG reference.",
		);
	}
	process.exit(1);
}

main();
