// B3 · runtime-trust — renders a review-weekly-v1 digest as Slack
// Block Kit payload. Consumer: `memory review --weekly --format
// slack-block-kit`. Kept deliberately tiny so the C4 Slack-digest
// task can extend it without rework.
//
// Block Kit reference:
// https://api.slack.com/reference/block-kit/blocks

import type {
	ContradictionCase,
	PoisonCandidateCase,
	ReviewCase,
	ReviewDigestV1,
	StaleHighValueCase,
} from "./review.service.js";

export interface SlackBlock {
	type: string;
	[key: string]: unknown;
}

export interface SlackBlockKitPayload {
	blocks: SlackBlock[];
}

function summaryLine(d: ReviewDigestV1): string {
	const s = d.summary;
	const parts = [
		`*${s.stale_high_value}* stale`,
		`*${s.contradictions}* contradictions`,
		`*${s.poison_candidates}* poison candidates`,
	];
	if (s.deferred > 0) parts.push(`_${s.deferred} deferred_`);
	return parts.join(" · ");
}

function renderStale(c: StaleHighValueCase): string {
	return [
		`• *Stale · ${c.impact_level}* — ${c.title}`,
		`    \`${c.entry_id}\` · score ${c.trust_score.toFixed(2)} · ${c.days_since_validation}d since validation`,
	].join("\n");
}

function renderContradiction(c: ContradictionCase): string {
	return [
		`• *Contradiction* — ${c.description}`,
		`    A: \`${c.entry_a.id}\` ${c.entry_a.title}`,
		`    B: \`${c.entry_b.id}\` ${c.entry_b.title}`,
	].join("\n");
}

function renderPoison(c: PoisonCandidateCase): string {
	return [
		`• *Poison candidate* — ${c.title}`,
		`    \`${c.entry_id}\` · score ${c.trust_score.toFixed(2)} · ${c.invalidation_count} invalidations in 30d`,
	].join("\n");
}

function renderCase(c: ReviewCase): string {
	if (c.kind === "stale_high_value") return renderStale(c);
	if (c.kind === "contradiction") return renderContradiction(c);
	return renderPoison(c);
}

export function toSlackBlockKit(digest: ReviewDigestV1): SlackBlockKitPayload {
	const blocks: SlackBlock[] = [
		{
			type: "header",
			text: { type: "plain_text", text: `Memory Review — ${digest.generated_at.slice(0, 10)}` },
		},
		{
			type: "section",
			text: { type: "mrkdwn", text: summaryLine(digest) },
		},
	];

	if (digest.cases.length === 0) {
		blocks.push({
			type: "section",
			text: { type: "mrkdwn", text: "_No open cases. Memory-store is clean._" },
		});
		return { blocks };
	}

	blocks.push({ type: "divider" });

	// One section per case — Slack caps section text at 3000 chars, each
	// case is far below that; grouping all cases into a single section
	// would blow the cap on large digests.
	for (const c of digest.cases) {
		blocks.push({
			type: "section",
			text: { type: "mrkdwn", text: renderCase(c) },
		});
	}

	return { blocks };
}
