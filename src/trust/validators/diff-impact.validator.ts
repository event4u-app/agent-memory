import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { MemoryEntry, MemoryEvidence } from "../../types.js";
import type { EvidenceValidator, ValidatorResult } from "./types.js";

const execFileAsync = promisify(execFile);

/** Threshold: if more than 50% of lines changed, consider it a major change */
const MAJOR_CHANGE_THRESHOLD = 0.5;

/**
 * Validates evidence by checking git diff impact on referenced files.
 * If watched files have been significantly changed since the entry was last validated,
 * trust should be reduced (semantic drift detection V1).
 */
export class DiffImpactValidator implements EvidenceValidator {
	readonly name = "diff-impact";

	constructor(private readonly repositoryRoot: string) {}

	async validate(entry: MemoryEntry, _evidence: MemoryEvidence[]): Promise<ValidatorResult> {
		const watchedFiles = entry.scope.files;
		if (watchedFiles.length === 0) {
			return {
				validator: this.name,
				passed: true,
				confidence: 0.2,
				reason: "No watched files to check for diff impact",
				checkedEvidenceIds: [],
			};
		}

		const sinceDate = entry.trust.validatedAt ?? entry.createdAt;
		const sinceIso = sinceDate.toISOString().split("T")[0]!;

		const impacts: { file: string; changeRatio: number }[] = [];
		const errors: string[] = [];

		for (const filePath of watchedFiles) {
			try {
				const changeRatio = await this.getChangeRatio(filePath, sinceIso);
				if (changeRatio !== null) {
					impacts.push({ file: filePath, changeRatio });
				}
			} catch {
				errors.push(filePath);
			}
		}

		if (impacts.length === 0 && errors.length > 0) {
			return {
				validator: this.name,
				passed: true,
				confidence: 0.1,
				reason: `Could not analyze diff for ${errors.length} files (not in git or other error)`,
				checkedEvidenceIds: [],
			};
		}

		if (impacts.length === 0) {
			return {
				validator: this.name,
				passed: true,
				confidence: 0.5,
				reason: "No changes detected in watched files",
				checkedEvidenceIds: [],
			};
		}

		const majorChanges = impacts.filter((i) => i.changeRatio > MAJOR_CHANGE_THRESHOLD);

		if (majorChanges.length === 0) {
			const maxChange = Math.max(...impacts.map((i) => i.changeRatio));
			return {
				validator: this.name,
				passed: true,
				confidence: 0.6,
				reason: `Watched files changed minimally (max ${Math.round(maxChange * 100)}% change)`,
				checkedEvidenceIds: [],
			};
		}

		const majorFiles = majorChanges.map((c) => `${c.file} (${Math.round(c.changeRatio * 100)}%)`);
		return {
			validator: this.name,
			passed: false,
			confidence: 0.7,
			reason: `Major changes in ${majorChanges.length} watched files: ${majorFiles.join(", ")}`,
			checkedEvidenceIds: [],
		};
	}

	/**
	 * Get the ratio of changed lines vs total lines for a file since a given date.
	 * Returns null if the file is not tracked by git.
	 */
	private async getChangeRatio(filePath: string, sinceDate: string): Promise<number | null> {
		try {
			// Get total lines in current file
			const { stdout: wcOutput } = await execFileAsync("wc", ["-l", filePath], {
				cwd: this.repositoryRoot,
			});
			const totalLines = parseInt(wcOutput.trim().split(/\s+/)[0]!, 10);
			if (totalLines === 0) return null;

			// Get changed lines since date
			const { stdout: diffOutput } = await execFileAsync(
				"git",
				["log", `--since=${sinceDate}`, "--format=", "--numstat", "--", filePath],
				{ cwd: this.repositoryRoot },
			);

			if (!diffOutput.trim()) return 0;

			let addedLines = 0;
			let deletedLines = 0;
			for (const line of diffOutput.trim().split("\n")) {
				const [added, deleted] = line.split("\t");
				if (added && deleted && added !== "-") {
					addedLines += parseInt(added, 10);
					deletedLines += parseInt(deleted, 10);
				}
			}

			const changedLines = addedLines + deletedLines;
			return Math.min(changedLines / totalLines, 1.0);
		} catch {
			return null;
		}
	}
}
