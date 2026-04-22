import { access } from "node:fs/promises";
import { resolve } from "node:path";
import type { MemoryEntry, MemoryEvidence } from "../../types.js";
import type { EvidenceValidator, ValidatorResult } from "./types.js";

/**
 * Validates that file-type evidence references still exist on disk.
 * Checks both evidence refs (kind=file) and scope.files.
 */
export class FileExistsValidator implements EvidenceValidator {
	readonly name = "file-exists";

	constructor(private readonly repositoryRoot: string) {}

	async validate(entry: MemoryEntry, evidence: MemoryEvidence[]): Promise<ValidatorResult> {
		const fileEvidence = evidence.filter((e) => e.kind === "file");
		const filePaths = new Set<string>([...fileEvidence.map((e) => e.ref), ...entry.scope.files]);

		if (filePaths.size === 0) {
			return {
				validator: this.name,
				passed: true,
				confidence: 0.3,
				reason: "No file references to validate",
				checkedEvidenceIds: [],
			};
		}

		const results: { path: string; exists: boolean; evidenceId?: string }[] = [];

		for (const filePath of filePaths) {
			const absolutePath = resolve(this.repositoryRoot, filePath);
			const exists = await this.fileExists(absolutePath);
			const evidenceId = fileEvidence.find((e) => e.ref === filePath)?.id;
			results.push({ path: filePath, exists, evidenceId });
		}

		const existingCount = results.filter((r) => r.exists).length;
		const missingCount = results.filter((r) => !r.exists).length;
		const total = results.length;
		const checkedIds = results.filter((r) => r.evidenceId).map((r) => r.evidenceId!);

		if (missingCount === 0) {
			return {
				validator: this.name,
				passed: true,
				confidence: 0.8,
				reason: `All ${total} referenced files exist`,
				checkedEvidenceIds: checkedIds,
			};
		}

		if (existingCount === 0) {
			const missingPaths = results.filter((r) => !r.exists).map((r) => r.path);
			return {
				validator: this.name,
				passed: false,
				confidence: 0.9,
				reason: `All ${total} referenced files are missing: ${missingPaths.join(", ")}`,
				checkedEvidenceIds: checkedIds,
			};
		}

		const missingPaths = results.filter((r) => !r.exists).map((r) => r.path);
		return {
			validator: this.name,
			passed: false,
			confidence: 0.6,
			reason: `${missingCount}/${total} referenced files missing: ${missingPaths.join(", ")}`,
			checkedEvidenceIds: checkedIds,
		};
	}

	private async fileExists(absolutePath: string): Promise<boolean> {
		try {
			await access(absolutePath);
			return true;
		} catch {
			return false;
		}
	}
}
