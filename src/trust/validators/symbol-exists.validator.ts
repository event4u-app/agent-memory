import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { MemoryEntry, MemoryEvidence } from "../../types.js";
import type { EvidenceValidator, ValidatorResult } from "./types.js";

/**
 * Validates that symbol-type evidence references still exist in the codebase.
 * Performs a simple text search for the symbol name in referenced files.
 *
 * V1: Regex-based symbol detection. V2 could use Tree-sitter for AST-level accuracy.
 */
export class SymbolExistsValidator implements EvidenceValidator {
  readonly name = "symbol-exists";

  constructor(private readonly repositoryRoot: string) {}

  async validate(entry: MemoryEntry, evidence: MemoryEvidence[]): Promise<ValidatorResult> {
    const symbolEvidence = evidence.filter((e) => e.kind === "symbol");
    const scopeSymbols = entry.scope.symbols;

    const allSymbols = new Set<string>([
      ...symbolEvidence.map((e) => e.ref),
      ...scopeSymbols,
    ]);

    if (allSymbols.size === 0) {
      return {
        validator: this.name,
        passed: true,
        confidence: 0.2,
        reason: "No symbol references to validate",
        checkedEvidenceIds: [],
      };
    }

    // Collect files to search in — scope.files + file evidence
    const searchFiles = new Set<string>([
      ...entry.scope.files,
      ...evidence.filter((e) => e.kind === "file").map((e) => e.ref),
    ]);

    if (searchFiles.size === 0) {
      return {
        validator: this.name,
        passed: true,
        confidence: 0.1,
        reason: "No files to search for symbols in",
        checkedEvidenceIds: symbolEvidence.map((e) => e.id),
      };
    }

    // Read all search files
    const fileContents = new Map<string, string>();
    for (const filePath of searchFiles) {
      try {
        const content = await readFile(resolve(this.repositoryRoot, filePath), "utf-8");
        fileContents.set(filePath, content);
      } catch {
        // File doesn't exist — handled by file-exists validator
      }
    }

    if (fileContents.size === 0) {
      return {
        validator: this.name,
        passed: false,
        confidence: 0.5,
        reason: "None of the referenced files could be read",
        checkedEvidenceIds: symbolEvidence.map((e) => e.id),
      };
    }

    // Search for each symbol
    const found: string[] = [];
    const missing: string[] = [];

    for (const symbol of allSymbols) {
      const symbolName = this.extractSymbolName(symbol);
      const existsInAnyFile = Array.from(fileContents.values()).some((content) =>
        content.includes(symbolName)
      );

      if (existsInAnyFile) {
        found.push(symbol);
      } else {
        missing.push(symbol);
      }
    }

    const checkedIds = symbolEvidence.map((e) => e.id);

    if (missing.length === 0) {
      return {
        validator: this.name,
        passed: true,
        confidence: 0.7,
        reason: `All ${found.length} symbols found in referenced files`,
        checkedEvidenceIds: checkedIds,
      };
    }

    if (found.length === 0) {
      return {
        validator: this.name,
        passed: false,
        confidence: 0.8,
        reason: `All ${missing.length} symbols missing: ${missing.join(", ")}`,
        checkedEvidenceIds: checkedIds,
      };
    }

    return {
      validator: this.name,
      passed: false,
      confidence: 0.6,
      reason: `${missing.length}/${allSymbols.size} symbols missing: ${missing.join(", ")}`,
      checkedEvidenceIds: checkedIds,
    };
  }

  /**
   * Extract the function/method name from a qualified symbol reference.
   * "OrderTotalService::recalculate" → "recalculate"
   * "recalculate(order: Order): Money" → "recalculate"
   * "OrderTotalService" → "OrderTotalService"
   */
  private extractSymbolName(symbol: string): string {
    // Remove signature: "recalculate(order: Order): Money" → "recalculate"
    const withoutSignature = symbol.replace(/\(.*$/, "");
    // Get last part: "OrderTotalService::recalculate" → "recalculate"
    const parts = withoutSignature.split(/::|\.|\//);
    return parts[parts.length - 1]!.trim();
  }
}
