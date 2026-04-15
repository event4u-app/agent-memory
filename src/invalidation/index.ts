export { readGitDiff, readGitDiffSince, type FileChange, type DiffResult } from "./git-diff.js";
export { matchFileWatches, matchSymbolWatches, type WatchMatch } from "./watchers.js";
export { detectDrift, type DriftResult, type DriftedSymbol } from "./semantic-drift.js";
export { softInvalidate, hardInvalidate, type InvalidationResult } from "./invalidation-flows.js";
export { TtlExpiryJob, type ExpiryJobResult } from "./ttl-expiry-job.js";
export { RevalidationJob, type RevalidationResult } from "./revalidation-job.js";
export { RollbackService, type RollbackReport, type AffectedTask } from "./rollback.js";
export { InvalidationOrchestrator, type InvalidationRunResult, type InvalidationRunOptions } from "./orchestrator.js";
