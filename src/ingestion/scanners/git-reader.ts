import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { MemoryType } from "../../types.js";
import { logger } from "../../utils/logger.js";
import type { IngestionCandidate } from "../candidate.js";

const execFileAsync = promisify(execFile);

export interface GitReaderOptions {
	root: string;
	repository: string;
	/** How many recent commits to read (default: 50) */
	maxCommits?: number;
	/** Only commits since this date (ISO format, e.g. "2026-01-01") */
	since?: string;
}

interface ParsedCommit {
	hash: string;
	subject: string;
	body: string;
	files: string[];
}

/**
 * Read recent git commits and extract memory candidates.
 * Conventional commit prefixes determine memory type:
 *   feat → architecture_decision or refactoring_note
 *   fix → bug_pattern
 *   refactor → refactoring_note
 *   docs → coding_convention
 */
export async function readGitCommits(options: GitReaderOptions): Promise<IngestionCandidate[]> {
	const { root, repository, maxCommits = 50, since } = options;
	const candidates: IngestionCandidate[] = [];

	try {
		const commits = await getCommits(root, maxCommits, since);
		logger.info({ commitCount: commits.length }, "Reading git commits for memory candidates");

		for (const commit of commits) {
			const candidate = commitToCandidate(commit, repository);
			if (candidate) candidates.push(candidate);
		}
	} catch (err) {
		logger.warn({ err }, "Failed to read git commits (not a git repo?)");
	}

	return candidates;
}

async function getCommits(root: string, max: number, since?: string): Promise<ParsedCommit[]> {
	const args = ["log", `--max-count=${max}`, "--format=%H%n%s%n%b%n---END---", "--name-only"];
	if (since) args.push(`--since=${since}`);

	const { stdout } = await execFileAsync("git", args, {
		cwd: root,
		maxBuffer: 1024 * 1024,
	});
	return parseGitLog(stdout);
}

function parseGitLog(output: string): ParsedCommit[] {
	const commits: ParsedCommit[] = [];
	const blocks = output.split("---END---\n");

	for (const block of blocks) {
		const trimmed = block.trim();
		if (!trimmed) continue;

		const lines = trimmed.split("\n");
		if (lines.length < 2) continue;

		const hash = lines[0]?.trim() ?? "";
		const subject = lines[1]?.trim() ?? "";
		if (!hash) continue;

		// Body = everything between subject and file list (empty line separates)
		const bodyLines: string[] = [];
		const fileLines: string[] = [];
		let inFiles = false;

		for (let i = 2; i < lines.length; i++) {
			const line = lines[i]!;
			if (!inFiles && line === "") {
				inFiles = true;
				continue;
			}
			if (inFiles) {
				if (line.trim()) fileLines.push(line.trim());
			} else {
				bodyLines.push(line);
			}
		}

		commits.push({
			hash: hash.slice(0, 12),
			subject,
			body: bodyLines.join("\n").trim(),
			files: fileLines,
		});
	}

	return commits;
}

function commitToCandidate(commit: ParsedCommit, repository: string): IngestionCandidate | null {
	// Skip trivial commits
	if (commit.subject.length < 10) return null;
	if (commit.subject.startsWith("Merge ")) return null;
	if (commit.subject.startsWith("chore: update")) return null;

	const type = detectTypeFromCommit(commit.subject);
	const summary = commit.body ? `${commit.subject}\n\n${commit.body}` : commit.subject;

	return {
		type,
		title: commit.subject,
		summary: summary.length > 500 ? `${summary.slice(0, 500)}…` : summary,
		details: summary.length > 500 ? summary : undefined,
		scope: {
			repository,
			files: commit.files.slice(0, 20), // Cap at 20 files
			symbols: [],
			modules: [],
		},
		embeddingText: `${commit.subject}\n${commit.body}`,
		source: "git-reader",
		evidence: [{ kind: "commit", ref: commit.hash }],
	};
}

function detectTypeFromCommit(subject: string): MemoryType {
	const lower = subject.toLowerCase();
	if (lower.startsWith("fix")) return "bug_pattern";
	if (lower.startsWith("refactor")) return "refactoring_note";
	if (lower.startsWith("docs")) return "coding_convention";
	if (lower.startsWith("test")) return "test_strategy";
	if (lower.startsWith("feat")) return "refactoring_note";
	if (lower.includes("deploy") || lower.includes("release")) return "deployment_warning";
	return "refactoring_note";
}
