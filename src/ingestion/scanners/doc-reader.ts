import { readFile, readdir } from "node:fs/promises";
import { join, relative, basename, extname } from "node:path";
import type { IngestionCandidate } from "../candidate.js";
import type { MemoryType } from "../../types.js";
import { logger } from "../../utils/logger.js";

/** Known doc directories to scan */
const DOC_DIRS = ["docs", "agents/adrs", "agents/docs", "agents/roadmaps"];

/** Filenames always scanned at repo root */
const ROOT_DOCS = ["README.md", "AGENTS.md", "CHANGELOG.md", "CONTRIBUTING.md"];

export interface DocReaderOptions {
  root: string;
  repository: string;
}

/**
 * Scan markdown documentation for knowledge candidates.
 * Extracts: ADRs → architecture_decision, README sections → glossary/conventions.
 */
export async function readDocs(options: DocReaderOptions): Promise<IngestionCandidate[]> {
  const { root, repository } = options;
  const candidates: IngestionCandidate[] = [];

  // Scan root-level docs
  for (const filename of ROOT_DOCS) {
    try {
      const content = await readFile(join(root, filename), "utf-8");
      candidates.push(...extractFromMarkdown(content, filename, repository));
    } catch {
      // File doesn't exist — skip
    }
  }

  // Scan doc directories
  for (const docDir of DOC_DIRS) {
    try {
      const dirPath = join(root, docDir);
      const entries = await readdir(dirPath, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isFile() || extname(entry.name) !== ".md") continue;
        const filePath = join(docDir, entry.name);
        const content = await readFile(join(root, filePath), "utf-8");
        candidates.push(...extractFromMarkdown(content, filePath, repository));
      }
    } catch {
      // Directory doesn't exist — skip
    }
  }

  logger.info({ candidateCount: candidates.length }, "Documentation scan complete");
  return candidates;
}

function extractFromMarkdown(
  content: string,
  filePath: string,
  repository: string,
): IngestionCandidate[] {
  const candidates: IngestionCandidate[] = [];
  const isAdr = filePath.includes("adr") || /\d{4}.*\.md$/.test(filePath);

  // Split by H2 sections
  const sections = content.split(/^## /m).slice(1);

  for (const section of sections) {
    const lines = section.split("\n");
    const heading = lines[0]?.trim() ?? "";
    const body = lines.slice(1).join("\n").trim();

    if (!heading || body.length < 30) continue; // Skip trivial sections

    const type = detectType(heading, isAdr ?? false);
    const summary = body.length > 300 ? body.slice(0, 300) + "…" : body;

    candidates.push({
      type,
      title: `${basename(filePath)}: ${heading}`,
      summary,
      details: body.length > 300 ? body : undefined,
      scope: { repository, files: [filePath], symbols: [], modules: [] },
      embeddingText: `${heading}\n${summary}`,
      source: "doc-reader",
      evidence: [{ kind: "documentation", ref: filePath, details: `Section: ${heading}` }],
    });
  }

  return candidates;
}

function detectType(heading: string, isAdr: boolean): MemoryType {
  const lower = heading.toLowerCase();

  if (isAdr || lower.includes("decision") || lower.includes("architecture")) {
    return "architecture_decision";
  }
  if (lower.includes("convention") || lower.includes("style") || lower.includes("standard")) {
    return "coding_convention";
  }
  if (lower.includes("glossary") || lower.includes("definition") || lower.includes("terminology")) {
    return "glossary_entry";
  }
  if (lower.includes("deploy") || lower.includes("release") || lower.includes("warning")) {
    return "deployment_warning";
  }
  if (lower.includes("test") || lower.includes("testing")) {
    return "test_strategy";
  }
  if (lower.includes("integration") || lower.includes("api") || lower.includes("constraint")) {
    return "integration_constraint";
  }
  if (lower.includes("domain") || lower.includes("rule") || lower.includes("business")) {
    return "domain_rule";
  }

  return isAdr ? "architecture_decision" : "coding_convention";
}
