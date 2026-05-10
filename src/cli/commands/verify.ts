import type { Command } from "commander";
import { ContradictionRepository } from "../../db/repositories/contradiction.repository.js";
import { EvidenceRepository } from "../../db/repositories/evidence.repository.js";
import { MemoryEntryRepository } from "../../db/repositories/memory-entry.repository.js";
import { closeDb, getDb } from "../context.js";

export function register(program: Command): void {
	program
		.command("verify")
		.description("Trace a memory entry to its evidence, contradictions, and audit trail")
		.argument("<id>", "Memory entry ID")
		.action(async (id) => {
			try {
				const sql = getDb();
				const entryRepo = new MemoryEntryRepository(sql);
				const evidenceRepo = new EvidenceRepository(sql);
				const contradictionRepo = new ContradictionRepository(sql);
				const entry = await entryRepo.findById(id);
				if (!entry) throw new Error(`Entry not found: ${id}`);
				const evidence = await evidenceRepo.findByEntryId(id);
				const contradictions = await contradictionRepo.findByEntryId(id);
				const history = await sql`
					SELECT from_status, to_status, reason, triggered_by, created_at
					FROM memory_status_history WHERE memory_entry_id = ${id}
					ORDER BY created_at DESC LIMIT 20
				`;
				console.log(
					JSON.stringify(
						{
							entry: {
								id: entry.id,
								title: entry.title,
								type: entry.type,
								status: entry.trust.status,
								trustScore: entry.trust.score,
							},
							evidence: evidence.map((e) => ({
								id: e.id,
								kind: e.kind,
								ref: e.ref,
								verified: !!e.verifiedAt,
							})),
							contradictions: contradictions.map((c) => ({
								id: c.id,
								resolved: !!c.resolvedAt,
							})),
							statusHistory: history.map((h) => ({
								from: h.from_status,
								to: h.to_status,
								reason: h.reason,
								by: h.triggered_by,
								at: h.created_at,
							})),
						},
						null,
						2,
					),
				);
				await closeDb();
				process.exit(0);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				console.error(JSON.stringify({ error: message }, null, 2));
				await closeDb();
				process.exit(1);
			}
		});
}
