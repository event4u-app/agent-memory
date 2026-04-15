import { describe, it, expect } from "vitest";
import { classifyCandidate, type IngestionCandidate } from "../../src/ingestion/candidate.js";

function makeCandidate(overrides: Partial<IngestionCandidate> = {}): IngestionCandidate {
  return {
    type: "architecture_decision",
    title: "Test",
    summary: "Test summary",
    scope: { repository: "test", files: [], symbols: [], modules: [] },
    embeddingText: "test",
    source: "file-scanner",
    evidence: [],
    ...overrides,
  };
}

describe("Auto-Classification", () => {
  it("classifies architecture_decision as critical + evergreen", () => {
    const result = classifyCandidate(makeCandidate({ type: "architecture_decision" }));
    expect(result.impactLevel).toBe("critical");
    expect(result.knowledgeClass).toBe("evergreen");
  });

  it("classifies bug_pattern as normal + volatile", () => {
    const result = classifyCandidate(makeCandidate({ type: "bug_pattern" }));
    expect(result.impactLevel).toBe("normal");
    expect(result.knowledgeClass).toBe("volatile");
  });

  it("classifies coding_convention as low + evergreen", () => {
    const result = classifyCandidate(makeCandidate({ type: "coding_convention" }));
    expect(result.impactLevel).toBe("low");
    expect(result.knowledgeClass).toBe("evergreen");
  });

  it("classifies deployment_warning as high + semi_stable", () => {
    const result = classifyCandidate(makeCandidate({ type: "deployment_warning" }));
    expect(result.impactLevel).toBe("high");
    expect(result.knowledgeClass).toBe("semi_stable");
  });

  it("assigns tier based on source", () => {
    expect(classifyCandidate(makeCandidate({ source: "observation" })).consolidationTier).toBe("working");
    expect(classifyCandidate(makeCandidate({ source: "session-summary" })).consolidationTier).toBe("episodic");
    expect(classifyCandidate(makeCandidate({ source: "file-scanner" })).consolidationTier).toBe("semantic");
    expect(classifyCandidate(makeCandidate({ source: "git-reader" })).consolidationTier).toBe("semantic");
    expect(classifyCandidate(makeCandidate({ source: "manual" })).consolidationTier).toBe("semantic");
  });

  it("defaults unknown source to semantic tier", () => {
    const result = classifyCandidate(makeCandidate({ source: "unknown-source" }));
    expect(result.consolidationTier).toBe("semantic");
  });
});
