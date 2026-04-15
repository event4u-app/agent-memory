import { readFile, readdir, stat } from "node:fs/promises";
import { join, relative, extname } from "node:path";
import type { IngestionCandidate } from "../candidate.js";
import { logger } from "../../utils/logger.js";

/** File extensions to scan */
const SCANNABLE_EXTENSIONS = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs",
  ".php", ".py", ".rb", ".go", ".rs", ".java", ".kt",
  ".vue", ".svelte",
]);

/** Directories to skip */
const SKIP_DIRS = new Set([
  "node_modules", ".git", "vendor", "dist", "build", ".next",
  "__pycache__", ".venv", "target", ".idea", ".vscode",
]);

const MAX_FILE_SIZE = 100_000; // 100KB — skip very large files

export interface FileScannerOptions {
  /** Repository root path */
  root: string;
  /** Repository name for scope */
  repository: string;
  /** Max files to scan (safety limit) */
  maxFiles?: number;
}

/**
 * Scan source files for exported classes, interfaces, and TODO/FIXME/HACK comments.
 * V1: lightweight regex-based extraction. V2 could use Tree-sitter.
 */
export async function scanFiles(options: FileScannerOptions): Promise<IngestionCandidate[]> {
  const { root, repository, maxFiles = 500 } = options;
  const candidates: IngestionCandidate[] = [];
  const files = await collectFiles(root, root, maxFiles);

  logger.info({ fileCount: files.length, root }, "Scanning files for memory candidates");

  for (const filePath of files) {
    try {
      const content = await readFile(join(root, filePath), "utf-8");
      const fileCandidates = extractCandidates(content, filePath, repository);
      candidates.push(...fileCandidates);
    } catch {
      // Skip unreadable files
    }
  }

  logger.info({ candidateCount: candidates.length }, "File scan complete");
  return candidates;
}

async function collectFiles(dir: string, root: string, maxFiles: number): Promise<string[]> {
  const files: string[] = [];
  const entries = await readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    if (files.length >= maxFiles) break;

    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      const subFiles = await collectFiles(join(dir, entry.name), root, maxFiles - files.length);
      files.push(...subFiles);
    } else if (entry.isFile()) {
      const ext = extname(entry.name);
      if (!SCANNABLE_EXTENSIONS.has(ext)) continue;

      const fullPath = join(dir, entry.name);
      const fileStat = await stat(fullPath);
      if (fileStat.size > MAX_FILE_SIZE) continue;

      files.push(relative(root, fullPath));
    }
  }
  return files;
}

function extractCandidates(
  content: string,
  filePath: string,
  repository: string,
): IngestionCandidate[] {
  const candidates: IngestionCandidate[] = [];
  const lines = content.split("\n");

  // Extract TODO/FIXME/HACK comments as bug_pattern or refactoring_note
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const todoMatch = line.match(/(?:\/\/|#|\/\*)\s*(TODO|FIXME|HACK|XXX)[\s:]+(.+)/i);
    if (todoMatch) {
      const tag = todoMatch[1]!.toUpperCase();
      const comment = todoMatch[2]!.trim();
      candidates.push({
        type: tag === "FIXME" || tag === "HACK" ? "bug_pattern" : "refactoring_note",
        title: `${tag} in ${filePath}:${i + 1}`,
        summary: comment,
        scope: { repository, files: [filePath], symbols: [], modules: [] },
        embeddingText: `${tag}: ${comment} (file: ${filePath})`,
        source: "file-scanner",
        evidence: [{ kind: "file", ref: filePath, details: `Line ${i + 1}` }],
      });
    }
  }

  // Extract exported class/interface names as coding_convention candidates
  const exportedSymbols = content.match(/export\s+(?:default\s+)?(?:class|interface|type|enum|function|const)\s+(\w+)/g);
  if (exportedSymbols && exportedSymbols.length > 0) {
    const symbolNames = exportedSymbols.map((m) => {
      const match = m.match(/(?:class|interface|type|enum|function|const)\s+(\w+)/);
      return match?.[1] ?? "";
    }).filter(Boolean);

    if (symbolNames.length > 0) {
      candidates.push({
        type: "coding_convention",
        title: `Exports in ${filePath}`,
        summary: `File exports: ${symbolNames.join(", ")}`,
        scope: { repository, files: [filePath], symbols: symbolNames, modules: [] },
        embeddingText: `${filePath} exports: ${symbolNames.join(", ")}`,
        source: "file-scanner",
        evidence: [{ kind: "file", ref: filePath }],
      });
    }
  }

  return candidates;
}
