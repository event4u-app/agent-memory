export { applyPrivacyFilter, stripSecrets, stripPII, stripPrivateTags, stripEnvValues, normalizePaths, shannonEntropy } from "./privacy-filter.js";
export { classifyCandidate, type IngestionCandidate, type CandidateEvidence, type Classification } from "./candidate.js";
export { IngestionPipeline, type IngestionResult, type PipelineOptions } from "./pipeline.js";
export { ExtractionGuard, type ExtractionGuardOptions, type GuardCheckResult } from "./extraction-guard.js";
export { scanFiles, type FileScannerOptions } from "./scanners/file-scanner.js";
export { readDocs, type DocReaderOptions } from "./scanners/doc-reader.js";
export { readGitCommits, type GitReaderOptions } from "./scanners/git-reader.js";
export { extractSymbols, extractSymbolsFromFiles, type ExtractedSymbol } from "./scanners/symbol-extractor.js";
