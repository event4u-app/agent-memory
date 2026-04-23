/**
 * CHANGELOG freshness guard (P6-6).
 *
 * Contract:
 *   - `package.json` version X.Y.Z MUST have a matching non-
 *     `[Unreleased]` section `## [X.Y.Z]` in CHANGELOG.md.
 *   - Exception: `0.1.0` is the historical baseline predating
 *     CHANGELOG introduction (see the version-tracking note in
 *     CHANGELOG.md). It is treated as covered by `[1.0.0]`.
 *
 * Run with `npm run check:changelog`.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const PKG_PATH = resolve(process.cwd(), "package.json");
const CHANGELOG_PATH = resolve(process.cwd(), "CHANGELOG.md");

// Versions that the CHANGELOG does not (and will not) document explicitly.
// `0.1.0` predates CHANGELOG adoption; the 1.0.0 section acknowledges this.
const HISTORICAL_BASELINE = new Set(["0.1.0"]);

function main(): void {
	const pkg = JSON.parse(readFileSync(PKG_PATH, "utf8")) as {
		version?: string;
	};
	const version = pkg.version;
	if (!version) {
		// biome-ignore lint/suspicious/noConsole: CLI diagnostic
		console.error("❌  package.json has no `version` field.");
		process.exit(1);
	}
	if (HISTORICAL_BASELINE.has(version)) {
		// biome-ignore lint/suspicious/noConsole: CLI diagnostic
		console.log(
			`✅  CHANGELOG guard: version ${version} is the historical baseline (covered by [1.0.0]).`,
		);
		return;
	}

	const changelog = readFileSync(CHANGELOG_PATH, "utf8");
	// Match `## [X.Y.Z]` possibly followed by date or other metadata.
	const pattern = new RegExp(
		`^## \\[${version.replace(/\./g, "\\.")}\\](?![a-zA-Z0-9])`,
		"m",
	);
	if (!pattern.test(changelog)) {
		// biome-ignore lint/suspicious/noConsole: CLI diagnostic
		console.error(
			`❌  CHANGELOG freshness guard: package.json version ${version} has no matching \`## [${version}]\` section in CHANGELOG.md.`,
		);
		// biome-ignore lint/suspicious/noConsole: CLI hint
		console.error(
			"\nBumping package.json requires a corresponding CHANGELOG entry (see Keep a Changelog 1.1.0).",
		);
		process.exit(1);
	}

	// biome-ignore lint/suspicious/noConsole: CLI diagnostic
	console.log(
		`✅  CHANGELOG guard: package.json version ${version} matches CHANGELOG section.`,
	);
}

main();
