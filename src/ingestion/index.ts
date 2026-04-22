export {
	type CandidateEvidence,
	type Classification,
	classifyCandidate,
	type IngestionCandidate,
} from "./candidate.js";
export {
	ExtractionGuard,
	type ExtractionGuardOptions,
	type GuardCheckResult,
} from "./extraction-guard.js";
export {
	IngestionPipeline,
	type IngestionResult,
	type PipelineOptions,
} from "./pipeline.js";
export {
	applyPrivacyFilter,
	normalizePaths,
	shannonEntropy,
	stripEnvValues,
	stripPII,
	stripPrivateTags,
	stripSecrets,
} from "./privacy-filter.js";
export { type DocReaderOptions, readDocs } from "./scanners/doc-reader.js";
export { type FileScannerOptions, scanFiles } from "./scanners/file-scanner.js";
export {
	type GitReaderOptions,
	readGitCommits,
} from "./scanners/git-reader.js";
export {
	type ExtractedSymbol,
	extractSymbols,
	extractSymbolsFromFiles,
} from "./scanners/symbol-extractor.js";
