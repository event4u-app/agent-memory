// B1 · runtime-trust — `memory explain <id>` CLI wrapper around
// `explainEntry`. Default: human breakdown. `--json`: explain-v1 envelope
// (schema: tests/fixtures/retrieval/explain-v1.schema.json).

import type { Command } from "commander";
import { ContradictionRepository } from "../../db/repositories/contradiction.repository.js";
import { EvidenceRepository } from "../../db/repositories/evidence.repository.js";
import { MemoryEntryRepository } from "../../db/repositories/memory-entry.repository.js";
import { MemoryEventRepository } from "../../db/repositories/memory-event.repository.js";
import { type ExplainV1, explainEntry } from "../../trust/explain.service.js";
import { closeDb, getDb } from "../context.js";

function renderHuman(e: ExplainV1): string {
	const lines: string[] = [];
	lines.push(`${e.entry.id}  —  ${e.entry.title}`);
	lines.push(
		`  status=${e.entry.status}  impact=${e.entry.impact_level}  class=${e.entry.knowledge_class}`,
	);
	lines.push(
		`  stored_score=${e.entry.stored_score.toFixed(3)}  computed=${e.score.computed.toFixed(3)}  access_count=${e.entry.access_count}`,
	);
	lines.push("");
	lines.push("Score breakdown:");
	const c = e.score.components;
	lines.push(
		`  evidence         contribution=${c.evidence.contribution.toFixed(3)}  (${c.evidence.count}/${c.evidence.min_required})  ${c.evidence.note}`,
	);
	lines.push(
		`  access_boost     contribution=+${c.access_boost.contribution.toFixed(3)}  (max +${c.access_boost.max.toFixed(2)})  ${c.access_boost.note}`,
	);
	lines.push(
		`  decay            penalty=-${c.decay.penalty.toFixed(3)}  (ttl=${c.decay.ttl_days}d, age=${c.decay.days_since_validation.toFixed(1)}d)  ${c.decay.note}`,
	);
	if (c.single_evidence_cap.applied) {
		lines.push(`  single-evidence cap  APPLIED at ${c.single_evidence_cap.cap}`);
	}
	lines.push("");
	lines.push("Why not 0.9+:");
	if (e.score.why_not_max.length === 0) lines.push("  (none — score is at or above 0.9)");
	else for (const w of e.score.why_not_max) lines.push(`  · ${w}`);
	lines.push("");
	lines.push(`Promotion history (${e.promotion_history.length} event(s)):`);
	if (e.promotion_history.length === 0) lines.push("  (no trust events recorded)");
	else
		for (const h of e.promotion_history)
			lines.push(
				`  ${h.occurred_at}  ${h.event_type.padEnd(20)}  by ${h.actor}${h.reason ? `  — ${h.reason}` : ""}`,
			);
	lines.push("");
	lines.push(`Contradictions: ${e.contradictions.length}`);
	for (const x of e.contradictions)
		lines.push(`  ${x.resolved ? "[resolved]" : "[OPEN]    "}  ${x.id}  ${x.description}`);
	lines.push("");
	lines.push(
		`Decay: expires ${e.decay.expires_at}  (${e.decay.days_until_expiry.toFixed(1)}d remaining${e.decay.stale_at_current_rate ? " — STALE" : ""})`,
	);
	return lines.join("\n");
}

export function register(program: Command): void {
	program
		.command("explain <id>")
		.description("Explain how a memory entry's trust_score was calculated (B1 · runtime-trust)")
		.option("--json", "Emit explain-v1 JSON envelope instead of human output")
		.action(async (id: string, options: { json?: boolean }) => {
			try {
				const sql = getDb();
				const eventRepo = new MemoryEventRepository(sql);
				const entryRepo = new MemoryEntryRepository(sql, eventRepo);
				const evidenceRepo = new EvidenceRepository(sql);
				const contradictionRepo = new ContradictionRepository(sql);
				const entry = await entryRepo.findById(id);
				if (!entry) {
					console.error(JSON.stringify({ error: `Entry not found: ${id}` }));
					await closeDb();
					process.exit(1);
					return;
				}
				const [evidence, events, contradictions] = await Promise.all([
					evidenceRepo.findByEntryId(id),
					eventRepo.listByEntry(id, 200),
					contradictionRepo.findByEntryId(id),
				]);
				const explain = explainEntry({
					entry,
					evidenceCount: evidence.length,
					events,
					contradictions,
				});
				if (options.json) console.log(JSON.stringify(explain, null, 2));
				else console.log(renderHuman(explain));
				await closeDb();
				process.exit(0);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				console.error(JSON.stringify({ error: message }));
				await closeDb();
				process.exit(1);
			}
		});
}
