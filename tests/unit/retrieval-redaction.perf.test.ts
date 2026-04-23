import { describe, expect, it } from "vitest";
import { redactEntriesForRetrieval } from "../../src/security/retrieval-redaction.js";

/**
 * Micro-benchmark for III2 · Retrieval-Output-Filter.
 *
 * Roadmap SLO — P99 retrieve < 500 ms. The filter's isolated budget is
 * 100 ms on a 20 000-entry set so the rest of the retrieve pipeline keeps
 * 400 ms of headroom.
 *
 * CI variance safety factor: asserting against 500 ms (5× the design
 * budget) avoids flakes on slow runners while still detecting an order-
 * of-magnitude regression in the filter itself. When the assertion trips,
 * the console line right above it prints the actual measured time — so
 * the first diagnostic signal is a real number, not a pass/fail.
 */

const FIXTURE_SIZE = 20_000;
const PERF_BUDGET_MS = 500;

function makeCleanEntry(i: number): { id: string; type: string; body: Record<string, unknown> } {
	return {
		id: `entry-${i}`,
		type: "architecture-decision",
		body: {
			title: `Decision ${i}: keep payment logic in billing service`,
			summary: `Rationale ${i}: trust boundaries and blast radius considerations. See ADR-${i}.`,
			scope: { repository: "example-app", modules: ["billing", "payments"] },
			details:
				`Expanded context for entry ${i}. ` +
				"Quotes an operator handle like @alice and a commit hash 4f6c8d2a1b5e7c9f0d3a8b6e1c4f7d0a2b5e8c1f " +
				"that should NOT trigger the filter — the allow-list keeps SHAs, UUIDs, and semver literals quiet.",
		},
	};
}

describe("redactEntriesForRetrieval · performance", () => {
	it(`handles ${FIXTURE_SIZE} clean entries under ${PERF_BUDGET_MS} ms`, () => {
		const entries = Array.from({ length: FIXTURE_SIZE }, (_, i) => makeCleanEntry(i));
		// Warm-up pass — let the engine JIT the regexes before timing.
		redactEntriesForRetrieval(entries.slice(0, 1_000));

		const start = performance.now();
		const { warnings } = redactEntriesForRetrieval(entries);
		const elapsed = performance.now() - start;

		// eslint-disable-next-line no-console
		console.log(
			`[perf] redactEntriesForRetrieval on ${FIXTURE_SIZE} clean entries: ${elapsed.toFixed(1)} ms`,
		);
		expect(warnings).toEqual([]);
		expect(elapsed).toBeLessThan(PERF_BUDGET_MS);
	});
});
