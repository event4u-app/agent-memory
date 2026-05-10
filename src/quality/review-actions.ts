// B3 · runtime-trust — applies the three operator decisions from
// `memory review` to the store + audit-log.
// Accept  → triggers the default action per case kind + records
//           `review_accepted`.
// Defer   → records `review_deferred`; the case is suppressed for
//           DEFER_WINDOW_MINUTES on subsequent `memory review` runs
//           (see MemoryEventRepository.listCaseIdsByTypeSince).
// Skip    → records `review_skipped`; no side effect beyond audit.

import type { ContradictionRepository } from "../db/repositories/contradiction.repository.js";
import type { MemoryEntryRepository } from "../db/repositories/memory-entry.repository.js";
import type { MemoryEventRepository } from "../db/repositories/memory-event.repository.js";
import type { ReviewCase } from "./review.service.js";

export type ReviewDecision = "accept" | "defer" | "skip";

export const DEFER_WINDOW_MINUTES = 7 * 24 * 60; // 7 days

export interface ApplyActionDeps {
	entryRepo: MemoryEntryRepository;
	contradictionRepo: ContradictionRepository;
	eventRepo: MemoryEventRepository;
}

export interface ApplyActionResult {
	case_id: string;
	decision: ReviewDecision;
	action_taken: string;
}

async function acceptStale(
	caseItem: Extract<ReviewCase, { kind: "stale_high_value" }>,
	actor: string,
	deps: ApplyActionDeps,
): Promise<string> {
	// Accept for a stale high-value entry → deprecate it; the operator
	// confirmed "this is no longer current". Re-propose path exists via
	// `memory propose` if the knowledge is still needed in a new shape.
	await deps.entryRepo.transitionStatus(
		caseItem.entry_id,
		"archived",
		"review-accepted: stale high-value entry archived",
		actor,
	);
	return "entry archived";
}

async function acceptContradiction(
	caseItem: Extract<ReviewCase, { kind: "contradiction" }>,
	actor: string,
	deps: ApplyActionDeps,
): Promise<string> {
	// Accept for a contradiction → keep_both (non-destructive default).
	// Destructive strategies (keep_a/keep_b/reject_both) stay behind the
	// dedicated `memory_resolve_contradiction` MCP tool so the review
	// loop cannot silently reject evidence.
	await deps.contradictionRepo.resolve(caseItem.contradiction_id, "keep_both");
	await deps.eventRepo.record({
		entryId: null,
		actor,
		eventType: "review_accepted",
		metadata: {
			case_id: caseItem.case_id,
			strategy: "keep_both",
			contradiction_id: caseItem.contradiction_id,
		},
		reason: "review loop: contradiction marked keep_both",
	});
	return "contradiction resolved (keep_both)";
}

async function acceptPoison(
	caseItem: Extract<ReviewCase, { kind: "poison_candidate" }>,
	actor: string,
	deps: ApplyActionDeps,
): Promise<string> {
	// Accept for a poison candidate → mark poisoned. Full `memory poison`
	// cascade (dependency re-quarantine) stays behind the explicit CLI
	// to keep destructive writes opt-in; the review loop only flags.
	// `validated → poisoned` is a valid transition (types.ts).
	await deps.entryRepo.transitionStatus(
		caseItem.entry_id,
		"poisoned",
		"review-accepted: poison candidate marked poisoned",
		actor,
	);
	return "entry marked poisoned";
}

/**
 * Apply the operator's decision on a single review case. All writes
 * land in one actor trail so `memory history <id>` can reconstruct who
 * drove each trust transition.
 */
export async function applyReviewAction(
	caseItem: ReviewCase,
	decision: ReviewDecision,
	actor: string,
	deps: ApplyActionDeps,
): Promise<ApplyActionResult> {
	if (decision === "defer") {
		await deps.eventRepo.record({
			entryId: "entry_id" in caseItem ? caseItem.entry_id : null,
			actor,
			eventType: "review_deferred",
			metadata: { case_id: caseItem.case_id, kind: caseItem.kind },
			reason: "review loop: deferred",
		});
		return { case_id: caseItem.case_id, decision, action_taken: "deferred" };
	}

	if (decision === "skip") {
		await deps.eventRepo.record({
			entryId: "entry_id" in caseItem ? caseItem.entry_id : null,
			actor,
			eventType: "review_skipped",
			metadata: { case_id: caseItem.case_id, kind: caseItem.kind },
			reason: "review loop: skipped",
		});
		return { case_id: caseItem.case_id, decision, action_taken: "skipped" };
	}

	// decision === "accept"
	let taken: string;
	if (caseItem.kind === "stale_high_value") {
		taken = await acceptStale(caseItem, actor, deps);
	} else if (caseItem.kind === "contradiction") {
		taken = await acceptContradiction(caseItem, actor, deps);
	} else {
		taken = await acceptPoison(caseItem, actor, deps);
	}

	// Accept path records against entry_id when the case has one so
	// history-lookups on the entry pick up the accept trail; the stale
	// / poison acceptStale/Poison paths also touch entry_id indirectly
	// via transitionStatus (which audits on its own), but this extra
	// record carries the `case_id` metadata the defer-filter keys on.
	if (caseItem.kind !== "contradiction") {
		await deps.eventRepo.record({
			entryId: caseItem.entry_id,
			actor,
			eventType: "review_accepted",
			metadata: { case_id: caseItem.case_id, kind: caseItem.kind, action: taken },
			reason: `review loop: ${taken}`,
		});
	}

	return { case_id: caseItem.case_id, decision, action_taken: taken };
}
