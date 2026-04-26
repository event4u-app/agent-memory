/**
 * Negative-test fixture for the provider-boundary drift guard (III4).
 *
 * Feeds synthetic source strings through `scanSource` to ensure that
 * a direct provider import outside the allow-list produces a hit,
 * while allowed paths stay clean.
 */

import { describe, expect, it } from "vitest";
import { isAllowed, scanSource } from "../../scripts/check-embedding-boundary.js";

describe("provider-boundary drift guard (III4)", () => {
	it("flags a direct openai import in a non-boundary file", () => {
		const src = `import OpenAI from "openai";\nexport const c = new OpenAI();`;
		const hits = scanSource(src, "src/some/feature.ts");
		expect(hits).toHaveLength(1);
		expect(hits[0]?.kind).toBe("import");
		expect(hits[0]?.detail).toBe("openai");
	});

	it("flags a direct Google Generative AI import", () => {
		const src = `import { GoogleGenerativeAI } from "@google/generative-ai";`;
		const hits = scanSource(src, "src/other/feature.ts");
		expect(hits).toHaveLength(1);
		expect(hits[0]?.detail).toBe("@google/generative-ai");
	});

	it("flags a raw provider URL used in a fetch call", () => {
		const src = `await fetch("https://api.openai.com/v1/embeddings", { method: "POST" });`;
		const hits = scanSource(src, "src/rogue/fetch.ts");
		expect(hits).toHaveLength(1);
		expect(hits[0]?.kind).toBe("url");
		expect(hits[0]?.detail).toBe("api.openai.com");
	});

	it("ignores provider mentions inside line comments", () => {
		const src = `// openai, voyageai mentioned in docs — should not flag\nconst x = 1;`;
		expect(scanSource(src, "src/file.ts")).toHaveLength(0);
	});

	it("ignores provider mentions inside block-comment asterisk lines", () => {
		const src = ` * Imports from "openai" belong in the provider shim.\nconst y = 2;`;
		expect(scanSource(src, "src/file.ts")).toHaveLength(0);
	});

	it("isAllowed accepts the boundary file and providers/ prefix", () => {
		expect(isAllowed("src/embedding/boundary.ts")).toBe(true);
		expect(isAllowed("src/embedding/providers/openai.ts")).toBe(true);
		expect(isAllowed("src/embedding/factory.ts")).toBe(false);
		expect(isAllowed("src/mcp/tool-handlers.ts")).toBe(false);
	});

	it("detects multiple provider hits in a single file", () => {
		const src = [
			`import { OpenAI } from "openai";`,
			`import { VoyageAI } from "voyageai";`,
			`fetch("https://api.cohere.ai/v1/embed");`,
		].join("\n");
		const hits = scanSource(src, "src/rogue.ts");
		expect(hits.map((h) => h.detail).sort()).toEqual(["api.cohere.ai", "openai", "voyageai"]);
	});
});
