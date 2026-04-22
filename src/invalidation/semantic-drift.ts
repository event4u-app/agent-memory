import { type ExtractedSymbol, extractSymbols } from "../ingestion/scanners/symbol-extractor.js";
import type { MemoryEntry, MemoryEvidence } from "../types.js";
import { logger } from "../utils/logger.js";

export interface DriftResult {
	entryId: string;
	/** Symbols that have drifted (signature changed or removed) */
	driftedSymbols: DriftedSymbol[];
	/** Overall drift score (0.0 = no drift, 1.0 = everything changed) */
	driftScore: number;
	/** Whether drift exceeds the threshold for invalidation */
	shouldInvalidate: boolean;
}

export interface DriftedSymbol {
	symbolName: string;
	filePath: string;
	kind: "removed" | "signature_changed";
	/** Stored signature (from evidence/memory) */
	storedSignature?: string;
	/** Current signature (from code) */
	currentSignature?: string;
}

/** Drift score above this threshold triggers soft invalidation */
const DRIFT_THRESHOLD = 0.5;

/**
 * Detect semantic drift by comparing stored symbol signatures against current code.
 * Works per-entry: takes an entry + its evidence, extracts current symbols,
 * compares with stored references.
 */
export async function detectDrift(
	entry: MemoryEntry,
	evidence: MemoryEvidence[],
	root: string,
): Promise<DriftResult> {
	const symbolEvidence = evidence.filter((e) => e.kind === "symbol");
	const watchedSymbols = entry.scope.symbols;
	const watchedFiles = entry.scope.files;

	// Combine evidence symbols + scope symbols
	const allTracked = new Set([...symbolEvidence.map((e) => e.ref), ...watchedSymbols]);

	if (allTracked.size === 0) {
		return {
			entryId: entry.id,
			driftedSymbols: [],
			driftScore: 0,
			shouldInvalidate: false,
		};
	}

	// Extract current symbols from all watched files
	const currentSymbols = new Map<string, ExtractedSymbol>();
	for (const filePath of watchedFiles) {
		const symbols = await extractSymbols(filePath, root);
		for (const s of symbols) {
			currentSymbols.set(s.name, s);
		}
	}

	// Compare
	const drifted: DriftedSymbol[] = [];

	for (const trackedName of allTracked) {
		// Extract just the symbol name (strip qualified path)
		const symbolName = trackedName.includes("::") ? trackedName.split("::").pop()! : trackedName;

		const current = currentSymbols.get(symbolName);
		const storedEvidence = symbolEvidence.find((e) => e.ref === trackedName);

		if (!current) {
			// Symbol removed
			drifted.push({
				symbolName: trackedName,
				filePath: storedEvidence
					? findFileForEvidence(storedEvidence, watchedFiles)
					: (watchedFiles[0] ?? "unknown"),
				kind: "removed",
				storedSignature: storedEvidence?.details ?? undefined,
			});
			continue;
		}

		// Check signature drift (if we have a stored signature in evidence details)
		if (storedEvidence?.details) {
			const storedSig = storedEvidence.details;
			const currentSig = current.signature;
			if (storedSig !== currentSig && !signaturesMatch(storedSig, currentSig)) {
				drifted.push({
					symbolName: trackedName,
					filePath: current.filePath,
					kind: "signature_changed",
					storedSignature: storedSig,
					currentSignature: currentSig,
				});
			}
		}
	}

	const driftScore = allTracked.size > 0 ? drifted.length / allTracked.size : 0;

	if (drifted.length > 0) {
		logger.info(
			{ entryId: entry.id, driftScore, driftedCount: drifted.length },
			"Semantic drift detected",
		);
	}

	return {
		entryId: entry.id,
		driftedSymbols: drifted,
		driftScore,
		shouldInvalidate: driftScore >= DRIFT_THRESHOLD,
	};
}

/**
 * Fuzzy signature comparison — ignore whitespace differences.
 */
function signaturesMatch(a: string, b: string): boolean {
	const normalize = (s: string) => s.replace(/\s+/g, " ").trim();
	return normalize(a) === normalize(b);
}

function findFileForEvidence(evidence: MemoryEvidence, watchedFiles: string[]): string {
	// If evidence ref contains a file path portion, try to match
	for (const file of watchedFiles) {
		if (evidence.ref.includes(file) || file.includes(evidence.ref)) {
			return file;
		}
	}
	return watchedFiles[0] ?? "unknown";
}
