import { access } from "node:fs/promises";
import { resolve } from "node:path";
import type { MemoryEntry, MemoryEvidence } from "../../types.js";
import type { EvidenceValidator, ValidatorResult } from "./types.js";

/**
 * Validates that test-type evidence references still exist.
 *
 * V1: Checks if referenced test files exist on disk.
 * V2: Could actually run the tests and check pass/fail status.
 */
export class TestLinkedValidator implements EvidenceValidator {
	readonly name = "test-linked";

	constructor(private readonly repositoryRoot: string) {}

	async validate(_entry: MemoryEntry, evidence: MemoryEvidence[]): Promise<ValidatorResult> {
		const testEvidence = evidence.filter((e) => e.kind === "test");

		if (testEvidence.length === 0) {
			return {
				validator: this.name,
				passed: true,
				confidence: 0.1,
				reason: "No test evidence linked",
				checkedEvidenceIds: [],
			};
		}

		const results: { ref: string; exists: boolean; id: string }[] = [];

		for (const ev of testEvidence) {
			const absolutePath = resolve(this.repositoryRoot, ev.ref);
			const exists = await this.fileExists(absolutePath);
			results.push({ ref: ev.ref, exists, id: ev.id });
		}

		const existingCount = results.filter((r) => r.exists).length;
		const missingCount = results.filter((r) => !r.exists).length;
		const checkedIds = results.map((r) => r.id);

		if (missingCount === 0) {
			return {
				validator: this.name,
				passed: true,
				confidence: 0.6,
				reason: `All ${existingCount} linked test files exist`,
				checkedEvidenceIds: checkedIds,
			};
		}

		const missingRefs = results.filter((r) => !r.exists).map((r) => r.ref);
		if (existingCount === 0) {
			return {
				validator: this.name,
				passed: false,
				confidence: 0.7,
				reason: `All ${missingCount} linked test files are missing: ${missingRefs.join(", ")}`,
				checkedEvidenceIds: checkedIds,
			};
		}

		return {
			validator: this.name,
			passed: false,
			confidence: 0.5,
			reason: `${missingCount}/${results.length} linked test files missing: ${missingRefs.join(", ")}`,
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
