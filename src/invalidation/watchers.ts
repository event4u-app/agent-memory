import type { MemoryEntry } from "../types.js";
import type { FileChange } from "./git-diff.js";

export interface WatchMatch {
	entryId: string;
	entryTitle: string;
	matchType: "file" | "symbol" | "module";
	/** The specific file/symbol/module that matched */
	matched: string;
	/** The change that triggered the match */
	change: FileChange;
	/** Severity: how impactful is this change? */
	severity: "low" | "medium" | "high";
}

/**
 * Match memory entries against file changes.
 * Returns entries whose watched scope overlaps with changed files.
 */
export function matchFileWatches(entries: MemoryEntry[], changes: FileChange[]): WatchMatch[] {
	const matches: WatchMatch[] = [];
	const _changedPaths = new Set(changes.map((c) => c.filePath));
	const changedPathsMap = new Map(changes.map((c) => [c.filePath, c]));

	// Also index old paths for rename detection
	const renamedFrom = new Map<string, FileChange>();
	for (const change of changes) {
		if (change.isRenamed && change.oldPath) {
			renamedFrom.set(change.oldPath, change);
		}
	}

	for (const entry of entries) {
		for (const watchedFile of entry.scope.files) {
			// Direct match
			const directChange = changedPathsMap.get(watchedFile);
			if (directChange) {
				matches.push({
					entryId: entry.id,
					entryTitle: entry.title,
					matchType: "file",
					matched: watchedFile,
					change: directChange,
					severity: computeSeverity(directChange),
				});
				continue;
			}

			// Rename match: watched file was renamed away
			const renameChange = renamedFrom.get(watchedFile);
			if (renameChange) {
				matches.push({
					entryId: entry.id,
					entryTitle: entry.title,
					matchType: "file",
					matched: watchedFile,
					change: renameChange,
					severity: "high", // Renames always high
				});
			}
		}

		// Module-level matching: if any file in a watched module changed
		for (const watchedModule of entry.scope.modules) {
			for (const change of changes) {
				if (fileInModule(change.filePath, watchedModule)) {
					matches.push({
						entryId: entry.id,
						entryTitle: entry.title,
						matchType: "module",
						matched: watchedModule,
						change,
						severity: computeSeverity(change),
					});
					break; // One match per module per entry is enough
				}
			}
		}
	}

	return matches;
}

/**
 * Check if a symbol referenced by an entry was affected by a change.
 * Uses the change's file path to narrow scope, then caller must check
 * actual symbol existence via SymbolExistsValidator.
 */
export function matchSymbolWatches(entries: MemoryEntry[], changes: FileChange[]): WatchMatch[] {
	const matches: WatchMatch[] = [];
	const changedPathSet = new Set(changes.map((c) => c.filePath));
	const changedPathsMap = new Map(changes.map((c) => [c.filePath, c]));

	for (const entry of entries) {
		if (entry.scope.symbols.length === 0) continue;

		// Check if any of the entry's watched files were changed
		const affectedFiles = entry.scope.files.filter((f) => changedPathSet.has(f));
		if (affectedFiles.length === 0) continue;

		// If files containing symbols changed, flag for drift check
		for (const symbol of entry.scope.symbols) {
			for (const file of affectedFiles) {
				const change = changedPathsMap.get(file)!;
				matches.push({
					entryId: entry.id,
					entryTitle: entry.title,
					matchType: "symbol",
					matched: symbol,
					change,
					severity: computeSeverity(change),
				});
			}
		}
	}

	return matches;
}

function computeSeverity(change: FileChange): "low" | "medium" | "high" {
	if (change.isDeleted) return "high";
	if (change.isRenamed) return "high";
	const totalLines = change.linesAdded + change.linesDeleted;
	if (totalLines > 100) return "high";
	if (totalLines > 20) return "medium";
	return "low";
}

function fileInModule(filePath: string, moduleName: string): boolean {
	const normalizedModule = moduleName.toLowerCase().replace(/\s+/g, "-");
	const normalizedPath = filePath.toLowerCase();
	return (
		normalizedPath.includes(`/${normalizedModule}/`) ||
		normalizedPath.includes(`\\${normalizedModule}\\`) ||
		normalizedPath.startsWith(`${normalizedModule}/`)
	);
}
