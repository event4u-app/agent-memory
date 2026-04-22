export {
	type DiffResult,
	type FileChange,
	readGitDiff,
	readGitDiffSince,
} from "./git-diff.js";
export {
	hardInvalidate,
	type InvalidationResult,
	softInvalidate,
} from "./invalidation-flows.js";
export {
	InvalidationOrchestrator,
	type InvalidationRunOptions,
	type InvalidationRunResult,
} from "./orchestrator.js";
export {
	RevalidationJob,
	type RevalidationResult,
} from "./revalidation-job.js";
export {
	type AffectedTask,
	type RollbackReport,
	RollbackService,
} from "./rollback.js";
export {
	type DriftedSymbol,
	type DriftResult,
	detectDrift,
} from "./semantic-drift.js";
export { type ExpiryJobResult, TtlExpiryJob } from "./ttl-expiry-job.js";
export {
	matchFileWatches,
	matchSymbolWatches,
	type WatchMatch,
} from "./watchers.js";
