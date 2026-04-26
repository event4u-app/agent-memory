// C3 · runtime-trust — stable envelope for `memory invalidate --from-git-diff`.
//
// The external GitHub Action (`event4u-app/agent-memory-action`) renders
// this JSON into a PR comment. `contract_version: invalidate-git-diff-v1`
// pins the shape so drift on either side fails fast in contract tests.
//
// The envelope is additive on top of `InvalidationRunResult`: the
// orchestrator itself keeps its programmatic return type; this module
// only decorates it with contract metadata + a summary ready for
// rendering.

import type { InvalidationRunEntry, InvalidationRunResult } from "./orchestrator.js";

export const INVALIDATE_GIT_DIFF_CONTRACT_VERSION = "invalidate-git-diff-v1";

export interface InvalidateGitDiffEnvelope {
	contract_version: typeof INVALIDATE_GIT_DIFF_CONTRACT_VERSION;
	/** Repository identifier from `.agent-memory.yml` (null when unscoped). */
	repository: string | null;
	/** Git diff span. `fromRef` is the `--from-ref` argument; `toRef` defaults to HEAD. */
	diff: { files_changed: number; from_ref: string; to_ref: string };
	summary: {
		watch_matches: number;
		soft_invalidated: number;
		hard_invalidated: number;
		drift_detected: number;
		skipped: number;
	};
	entries: InvalidationRunEntry[];
}

export interface BuildEnvelopeArgs {
	result: InvalidationRunResult;
	repository: string | null;
}

/**
 * Wrap the orchestrator result in the `invalidate-git-diff-v1` envelope.
 * The summary uses snake_case field names because this JSON is consumed
 * by an external renderer (GitHub Action) — matching the convention of
 * the other contract-pinned envelopes in this repo.
 */
export function buildInvalidateGitDiffEnvelope(args: BuildEnvelopeArgs): InvalidateGitDiffEnvelope {
	const { result, repository } = args;
	return {
		contract_version: INVALIDATE_GIT_DIFF_CONTRACT_VERSION,
		repository,
		diff: {
			files_changed: result.diff.filesChanged,
			from_ref: result.diff.fromRef,
			to_ref: result.diff.toRef,
		},
		summary: {
			watch_matches: result.watchMatches,
			soft_invalidated: result.softInvalidated,
			hard_invalidated: result.hardInvalidated,
			drift_detected: result.driftDetected,
			skipped: result.skipped,
		},
		entries: result.entries,
	};
}
