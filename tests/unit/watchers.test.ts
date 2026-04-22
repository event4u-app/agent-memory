import { describe, expect, it } from "vitest";
import type { FileChange } from "../../src/invalidation/git-diff.js";
import { matchFileWatches, matchSymbolWatches } from "../../src/invalidation/watchers.js";
import type { MemoryEntry } from "../../src/types.js";

function makeEntry(files: string[], symbols: string[] = [], modules: string[] = []): MemoryEntry {
	return {
		id: `entry-${Math.random().toString(36).slice(2, 8)}`,
		type: "architecture_decision",
		title: "Test entry",
		summary: "Test",
		details: null,
		scope: { repository: "test", files, symbols, modules },
		impactLevel: "normal",
		knowledgeClass: "semi_stable",
		consolidationTier: "semantic",
		trust: {
			status: "validated",
			score: 0.8,
			validatedAt: new Date(),
			expiresAt: new Date("2026-06-01"),
		},
		embeddingText: "test",
		embedding: null,
		accessCount: 0,
		lastAccessedAt: null,
		createdBy: "agent",
		createdInTask: null,
		createdAt: new Date(),
		updatedAt: new Date(),
	};
}

function makeChange(
	filePath: string,
	added = 10,
	deleted = 5,
	extra: Partial<FileChange> = {},
): FileChange {
	return {
		filePath,
		linesAdded: added,
		linesDeleted: deleted,
		isNew: false,
		isDeleted: false,
		isRenamed: false,
		...extra,
	};
}

describe("matchFileWatches", () => {
	it("matches entries watching changed files", () => {
		const entries = [makeEntry(["src/index.ts", "src/config.ts"])];
		const changes = [makeChange("src/index.ts")];

		const matches = matchFileWatches(entries, changes);
		expect(matches).toHaveLength(1);
		expect(matches[0]?.matchType).toBe("file");
		expect(matches[0]?.matched).toBe("src/index.ts");
	});

	it("does not match entries watching unrelated files", () => {
		const entries = [makeEntry(["src/other.ts"])];
		const changes = [makeChange("src/index.ts")];

		const matches = matchFileWatches(entries, changes);
		expect(matches).toHaveLength(0);
	});

	it("detects renamed files that were being watched", () => {
		const entries = [makeEntry(["src/old-name.ts"])];
		const changes = [
			makeChange("src/new-name.ts", 0, 0, {
				isRenamed: true,
				oldPath: "src/old-name.ts",
			}),
		];

		const matches = matchFileWatches(entries, changes);
		expect(matches).toHaveLength(1);
		expect(matches[0]?.severity).toBe("high");
	});

	it("assigns high severity to deleted files", () => {
		const entries = [makeEntry(["src/deleted.ts"])];
		const changes = [makeChange("src/deleted.ts", 0, 50, { isDeleted: true })];

		const matches = matchFileWatches(entries, changes);
		expect(matches).toHaveLength(1);
		expect(matches[0]?.severity).toBe("high");
	});

	it("assigns severity based on line count", () => {
		const entries = [makeEntry(["src/file.ts"])];

		// Small change = low
		let matches = matchFileWatches(entries, [makeChange("src/file.ts", 5, 3)]);
		expect(matches[0]?.severity).toBe("low");

		// Medium change
		matches = matchFileWatches(entries, [makeChange("src/file.ts", 30, 10)]);
		expect(matches[0]?.severity).toBe("medium");

		// Large change = high
		matches = matchFileWatches(entries, [makeChange("src/file.ts", 80, 50)]);
		expect(matches[0]?.severity).toBe("high");
	});

	it("matches module-level watches", () => {
		const entries = [makeEntry([], [], ["ingestion"])];
		const changes = [makeChange("src/ingestion/pipeline.ts")];

		const matches = matchFileWatches(entries, changes);
		expect(matches).toHaveLength(1);
		expect(matches[0]?.matchType).toBe("module");
	});
});

describe("matchSymbolWatches", () => {
	it("flags symbol entries when their files change", () => {
		const entries = [makeEntry(["src/scoring.ts"], ["calculateTrustScore"])];
		const changes = [makeChange("src/scoring.ts", 20, 10)];

		const matches = matchSymbolWatches(entries, changes);
		expect(matches).toHaveLength(1);
		expect(matches[0]?.matchType).toBe("symbol");
		expect(matches[0]?.matched).toBe("calculateTrustScore");
	});

	it("does not flag symbols if their files were not changed", () => {
		const entries = [makeEntry(["src/other.ts"], ["someFunction"])];
		const changes = [makeChange("src/scoring.ts")];

		const matches = matchSymbolWatches(entries, changes);
		expect(matches).toHaveLength(0);
	});
});
