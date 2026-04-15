import { readFile } from "node:fs/promises";
import { join, extname } from "node:path";
import { logger } from "../../utils/logger.js";

/**
 * Extracted symbol with signature for semantic drift detection.
 */
export interface ExtractedSymbol {
  /** Symbol name (e.g. "calculateTrustScore") */
  name: string;
  /** Full qualified name (e.g. "scoring.calculateTrustScore") */
  qualifiedName: string;
  /** Kind of symbol */
  kind: "function" | "class" | "interface" | "type" | "const" | "method";
  /** Full signature string for drift comparison */
  signature: string;
  /** File where the symbol is defined */
  filePath: string;
  /** Line number (1-based) */
  line: number;
}

/**
 * Extract exported symbols and their signatures from a source file.
 * V1: Regex-based. V2 could use Tree-sitter for full AST accuracy.
 */
export async function extractSymbols(
  filePath: string,
  root: string,
): Promise<ExtractedSymbol[]> {
  const absolutePath = join(root, filePath);
  const ext = extname(filePath);

  try {
    const content = await readFile(absolutePath, "utf-8");

    switch (ext) {
      case ".ts":
      case ".tsx":
      case ".js":
      case ".jsx":
      case ".mjs":
        return extractTypeScriptSymbols(content, filePath);
      case ".php":
        return extractPhpSymbols(content, filePath);
      default:
        return [];
    }
  } catch {
    return [];
  }
}

// --- TypeScript / JavaScript ---

const TS_PATTERNS: { kind: ExtractedSymbol["kind"]; regex: RegExp }[] = [
  {
    kind: "function",
    regex: /^export\s+(?:async\s+)?function\s+(\w+)\s*(<[^>]*>)?\s*\(([^)]*)\)\s*(?::\s*([^\n{]+))?/gm,
  },
  {
    kind: "class",
    regex: /^export\s+(?:abstract\s+)?class\s+(\w+)(?:\s+extends\s+\w+)?(?:\s+implements\s+[\w,\s]+)?/gm,
  },
  {
    kind: "interface",
    regex: /^export\s+interface\s+(\w+)(?:\s+extends\s+[\w,\s]+)?/gm,
  },
  {
    kind: "type",
    regex: /^export\s+type\s+(\w+)/gm,
  },
  {
    kind: "const",
    regex: /^export\s+const\s+(\w+)\s*(?::\s*([^\n=]+))?\s*=/gm,
  },
];

function extractTypeScriptSymbols(content: string, filePath: string): ExtractedSymbol[] {
  const symbols: ExtractedSymbol[] = [];
  const lines = content.split("\n");

  for (const { kind, regex } of TS_PATTERNS) {
    let match: RegExpExecArray | null;
    // Reset regex
    regex.lastIndex = 0;
    while ((match = regex.exec(content)) !== null) {
      const name = match[1]!;
      const line = content.slice(0, match.index).split("\n").length;
      const signatureLine = lines[line - 1] ?? match[0];

      symbols.push({
        name,
        qualifiedName: `${filePath}::${name}`,
        kind,
        signature: signatureLine.trim(),
        filePath,
        line,
      });
    }
  }

  return symbols;
}

// --- PHP ---

const PHP_PATTERNS: { kind: ExtractedSymbol["kind"]; regex: RegExp }[] = [
  {
    kind: "class",
    regex: /^(?:final\s+|abstract\s+)?class\s+(\w+)/gm,
  },
  {
    kind: "interface",
    regex: /^interface\s+(\w+)/gm,
  },
  {
    kind: "method",
    regex: /^\s*(?:public|protected|private)\s+(?:static\s+)?function\s+(\w+)\s*\(([^)]*)\)\s*(?::\s*([^\n{]+))?/gm,
  },
  {
    kind: "function",
    regex: /^function\s+(\w+)\s*\(([^)]*)\)\s*(?::\s*([^\n{]+))?/gm,
  },
];

function extractPhpSymbols(content: string, filePath: string): ExtractedSymbol[] {
  const symbols: ExtractedSymbol[] = [];
  const lines = content.split("\n");

  for (const { kind, regex } of PHP_PATTERNS) {
    let match: RegExpExecArray | null;
    regex.lastIndex = 0;
    while ((match = regex.exec(content)) !== null) {
      const name = match[1]!;
      const line = content.slice(0, match.index).split("\n").length;
      const signatureLine = lines[line - 1] ?? match[0];

      symbols.push({
        name,
        qualifiedName: `${filePath}::${name}`,
        kind,
        signature: signatureLine.trim(),
        filePath,
        line,
      });
    }
  }

  return symbols;
}

/**
 * Extract symbols from multiple files.
 */
export async function extractSymbolsFromFiles(
  filePaths: string[],
  root: string,
): Promise<ExtractedSymbol[]> {
  const allSymbols: ExtractedSymbol[] = [];
  for (const filePath of filePaths) {
    const symbols = await extractSymbols(filePath, root);
    allSymbols.push(...symbols);
  }
  logger.debug({ fileCount: filePaths.length, symbolCount: allSymbols.length }, "Symbols extracted");
  return allSymbols;
}
