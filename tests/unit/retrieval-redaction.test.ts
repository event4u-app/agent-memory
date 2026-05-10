import { describe, expect, it } from "vitest";
import {
	RETRIEVAL_REDACTION_MARKER,
	RETRIEVAL_WARNING_CODE,
	redactDetailEntry,
	redactEntriesForRetrieval,
} from "../../src/security/retrieval-redaction.js";

/**
 * Build canary secrets the same way `tests/e2e/canaries.ts` does — split the
 * literal so GitHub's push-protection scanner does not flag the test file
 * at rest. The runtime string is byte-identical to what the pattern matches.
 */
const s = (...parts: string[]): string => parts.join("");

const GITHUB_CANARY = s("ghp_", "0123456789abcdefghijklmnopqrstuvwxyz01");
// AWS access keys are exactly 20 chars (AKIA + 16). Canary has one
// trailing char ("Y") so `agent_memory_canary` is visible in ops logs,
// but that trailing char is *not* part of the regex match.
const AWS_CANARY = s("AK", "IAAGENTMEMORYCANARY");
const AWS_CANARY_TAIL = "Y";

describe("redactEntriesForRetrieval", () => {
	it("returns entries unchanged and no warnings when bodies are clean", () => {
		const input = [
			{ id: "e1", type: "x", body: { title: "hello", summary: "nothing suspicious" } },
		];
		const { entries, warnings } = redactEntriesForRetrieval(input);
		expect(warnings).toEqual([]);
		expect(entries[0]?.body).toEqual(input[0]?.body);
	});

	it("redacts github_token in a body field and emits a single warning", () => {
		const input = [
			{
				id: "e1",
				type: "x",
				body: { title: "ok", summary: `leak: ${GITHUB_CANARY} trailing` },
			},
		];
		const { entries, warnings } = redactEntriesForRetrieval(input);
		expect(entries[0]?.body.summary).toBe(`leak: ${RETRIEVAL_REDACTION_MARKER} trailing`);
		expect(entries[0]?.body.title).toBe("ok");
		expect(warnings).toHaveLength(1);
		expect(warnings[0]).toEqual({
			code: RETRIEVAL_WARNING_CODE,
			entryId: "e1",
			patterns: ["github_token"],
			fields: ["summary"],
		});
	});

	it("aggregates multiple fields and patterns into one warning per entry", () => {
		const input = [
			{
				id: "e1",
				type: "x",
				body: {
					title: `aws: ${AWS_CANARY}`,
					summary: `gh: ${GITHUB_CANARY}`,
					details: `both ${AWS_CANARY} and ${GITHUB_CANARY}`,
				},
			},
		];
		const { entries, warnings } = redactEntriesForRetrieval(input);
		expect(entries[0]?.body.title).toBe(`aws: ${RETRIEVAL_REDACTION_MARKER}${AWS_CANARY_TAIL}`);
		expect(entries[0]?.body.summary).toBe(`gh: ${RETRIEVAL_REDACTION_MARKER}`);
		expect(warnings).toHaveLength(1);
		expect(warnings[0]?.patterns).toEqual(["aws_access_key", "github_token"]);
		expect(warnings[0]?.fields).toEqual(["details", "summary", "title"]);
	});

	it("emits one warning per affected entry", () => {
		const input = [
			{ id: "clean", type: "x", body: { title: "fine" } },
			{ id: "dirty", type: "x", body: { summary: GITHUB_CANARY } },
		];
		const { warnings } = redactEntriesForRetrieval(input);
		expect(warnings).toHaveLength(1);
		expect(warnings[0]?.entryId).toBe("dirty");
	});

	it("handles string-array fields one level deep", () => {
		const input = [{ id: "e1", type: "x", body: { tags: ["benign", `secret ${GITHUB_CANARY}`] } }];
		const { entries, warnings } = redactEntriesForRetrieval(input);
		expect(entries[0]?.body.tags).toEqual(["benign", `secret ${RETRIEVAL_REDACTION_MARKER}`]);
		expect(warnings[0]?.fields).toEqual(["tags"]);
	});

	it("does not touch non-string leaves (numbers, booleans, nested objects)", () => {
		const input = [
			{ id: "e1", type: "x", body: { count: 42, ok: true, nested: { s: GITHUB_CANARY } } },
		];
		const { entries, warnings } = redactEntriesForRetrieval(input);
		// Nested-object redaction is deliberately out of scope — raw body
		// shapes beyond one-deep string arrays stay verbatim so the filter
		// has a predictable SLO. III1 handles structured legacy data.
		expect(entries[0]?.body.count).toBe(42);
		expect(entries[0]?.body.ok).toBe(true);
		expect(warnings).toEqual([]);
	});
});

describe("redactDetailEntry", () => {
	it("returns null warning when all named fields are clean", () => {
		const entry = { id: "e1", title: "hi", summary: "fine", details: "nothing" };
		const { entry: out, warning } = redactDetailEntry(entry, ["title", "summary", "details"]);
		expect(warning).toBeNull();
		expect(out).toEqual(entry);
	});

	it("redacts only the listed fields and reports pattern + field", () => {
		const entry = {
			id: "e1",
			title: "hi",
			summary: `leak ${GITHUB_CANARY}`,
			details: `also ${AWS_CANARY}`,
			ignored: `never touched ${GITHUB_CANARY}`,
		};
		const { entry: out, warning } = redactDetailEntry(entry, ["title", "summary", "details"]);
		expect(out.summary).toBe(`leak ${RETRIEVAL_REDACTION_MARKER}`);
		expect(out.details).toBe(`also ${RETRIEVAL_REDACTION_MARKER}${AWS_CANARY_TAIL}`);
		expect(out.ignored).toBe(`never touched ${GITHUB_CANARY}`);
		expect(warning).not.toBeNull();
		expect(warning?.patterns).toEqual(["aws_access_key", "github_token"]);
		expect(warning?.fields).toEqual(["details", "summary"]);
	});
});
