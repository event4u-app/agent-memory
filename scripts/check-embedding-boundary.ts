/**
 * Provider-boundary drift guard (roadmap III4).
 *
 * Ensures every outbound call to a third-party embedding provider is
 * funneled through `src/embedding/boundary.ts` (the secret-ingress
 * guard) and the dedicated provider shims under
 * `src/embedding/providers/`. Any other file in `src/` that imports a
 * provider SDK or hits a provider URL via `node-fetch` / `undici` is
 * treated as a drift and fails CI.
 *
 * Why: I3 enforces the guard at runtime. Without this drift check,
 * nothing stops a future PR from introducing a second HTTP path that
 * silently bypasses `secureEmbeddingInput`.
 *
 * Run with `npm run check:embedding-boundary`. CI runs the same
 * command as part of the quality job.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(process.cwd(), "src");

// Provider SDK packages that MUST only be imported from the boundary
// paths. Add a new entry here when a new provider is wired up.
const PROVIDER_PACKAGES = [
	"openai",
	"@google/generative-ai",
	"@google-ai/generativelanguage",
	"voyageai",
	"cohere-ai",
	"@anthropic-ai/sdk",
	"@mistralai/mistralai",
];

// Provider URLs that must not appear as string literals outside of
// the boundary — catches raw `fetch()` / `undici` calls.
const PROVIDER_URL_FRAGMENTS = [
	"api.openai.com",
	"generativelanguage.googleapis.com",
	"api.voyageai.com",
	"api.cohere.ai",
	"api.anthropic.com",
	"api.mistral.ai",
];

// Allow-list: paths (relative to repo root) that are allowed to
// contain provider imports or URLs.
const ALLOWED_PREFIXES = [
	"src/embedding/boundary.ts",
	"src/embedding/providers/",
	// Tests live under `tests/`, not `src/`, so no exception needed here.
];

export interface Hit {
	file: string;
	line: number;
	kind: "import" | "url";
	detail: string;
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

function isAllowed(relPath: string): boolean {
	return ALLOWED_PREFIXES.some((prefix) =>
		prefix.endsWith("/") ? relPath.startsWith(prefix) : relPath === prefix,
	);
}

export function scanSource(source: string, rel: string): Hit[] {
	const hits: Hit[] = [];
	const lines = source.split("\n");
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		if (line === undefined) continue;
		// Skip comments to avoid flagging doc mentions.
		const trimmed = line.trim();
		if (trimmed.startsWith("//") || trimmed.startsWith("*")) continue;

		for (const pkg of PROVIDER_PACKAGES) {
			const re = new RegExp(
				`\\b(from|require|import)\\s*\\(?\\s*["']${pkg.replace(/[/\\^$*+?.()|[\]{}]/g, "\\$&")}(/.*)?["']`,
			);
			if (re.test(line)) {
				hits.push({ file: rel, line: i + 1, kind: "import", detail: pkg });
			}
		}
		for (const frag of PROVIDER_URL_FRAGMENTS) {
			if (line.includes(frag)) {
				hits.push({ file: rel, line: i + 1, kind: "url", detail: frag });
			}
		}
	}
	return hits;
}

function scanFile(file: string): Hit[] {
	const rel = path.relative(process.cwd(), file);
	return scanSource(readFileSync(file, "utf8"), rel);
}

export { isAllowed, ALLOWED_PREFIXES, PROVIDER_PACKAGES, PROVIDER_URL_FRAGMENTS };

function main(): void {
	const files = walk(ROOT);
	const drift: Hit[] = [];
	for (const file of files) {
		const rel = path.relative(process.cwd(), file);
		if (isAllowed(rel)) continue;
		drift.push(...scanFile(file));
	}

	if (drift.length === 0) {
		// biome-ignore lint/suspicious/noConsole: CLI diagnostic
		console.log(
			`✅  embedding-boundary: 0 drift — ${files.length} file(s) scanned, allow-list: ${ALLOWED_PREFIXES.join(", ")}`,
		);
		return;
	}

	// biome-ignore lint/suspicious/noConsole: CLI diagnostic
	console.error(
		`❌  embedding-boundary: ${drift.length} drift hit(s) — provider access outside boundary/providers/:`,
	);
	for (const h of drift) {
		// biome-ignore lint/suspicious/noConsole: CLI diagnostic
		console.error(`   ${h.file}:${h.line}  [${h.kind}]  ${h.detail}`);
	}
	// biome-ignore lint/suspicious/noConsole: CLI diagnostic
	console.error(
		`\nProvider calls must go through src/embedding/boundary.ts +\nsrc/embedding/providers/*. See agents/roadmaps/secret-safety.md (III4).`,
	);
	process.exit(1);
}

// Only run when executed directly — tests import the scanner.
if (import.meta.url === `file://${process.argv[1]}`) {
	main();
}
