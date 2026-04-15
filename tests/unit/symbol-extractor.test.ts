import { describe, it, expect } from "vitest";
import { extractSymbols } from "../../src/ingestion/scanners/symbol-extractor.js";

describe("Symbol Extractor", () => {
  const root = process.cwd();

  it("extracts exported symbols from TypeScript files", async () => {
    const symbols = await extractSymbols("src/types.ts", root);
    expect(symbols.length).toBeGreaterThan(0);

    const names = symbols.map((s) => s.name);
    expect(names).toContain("MEMORY_TYPES");
    expect(names).toContain("IMPACT_LEVELS");
  });

  it("extracts functions with signatures", async () => {
    const symbols = await extractSymbols("src/trust/scoring.ts", root);
    const calcScore = symbols.find((s) => s.name === "calculateTrustScore");
    expect(calcScore).toBeDefined();
    expect(calcScore!.kind).toBe("function");
    expect(calcScore!.signature).toContain("calculateTrustScore");
  });

  it("extracts classes", async () => {
    const symbols = await extractSymbols("src/trust/transitions.ts", root);
    const cls = symbols.find((s) => s.name === "InvalidTransitionError");
    expect(cls).toBeDefined();
    expect(cls!.kind).toBe("class");
  });

  it("extracts interfaces", async () => {
    const symbols = await extractSymbols("src/trust/validators/types.ts", root);
    const names = symbols.map((s) => s.name);
    expect(names).toContain("ValidatorResult");
    expect(names).toContain("EvidenceValidator");
  });

  it("returns empty for non-existent files", async () => {
    const symbols = await extractSymbols("nonexistent.ts", root);
    expect(symbols).toEqual([]);
  });

  it("includes file path and line number", async () => {
    const symbols = await extractSymbols("src/types.ts", root);
    for (const s of symbols) {
      expect(s.filePath).toBe("src/types.ts");
      expect(s.line).toBeGreaterThan(0);
    }
  });
});
