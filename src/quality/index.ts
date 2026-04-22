export { type ArchivalResult, purgeArchived, runArchival } from "./archival.js";
export {
	listUnresolved,
	type ResolutionResult,
	type ResolutionStrategy,
	resolveContradiction,
	type UnresolvedContradiction,
} from "./contradiction-resolution.js";
export {
	type DuplicateGroup,
	findDuplicates,
	type MergeResult,
	mergeDuplicates,
} from "./dedup.js";
export {
	diffSnapshots,
	exportSnapshot,
	type MemorySnapshot,
} from "./export.js";
export { calculateMetrics, type QualityMetrics } from "./metrics.js";
