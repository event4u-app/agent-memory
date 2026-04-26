import type { Command } from "commander";
import { MemoryEntryRepository } from "../../db/repositories/memory-entry.repository.js";
import { buildEmbeddingChain } from "../../embedding/index.js";
import {
	CONTRACT_VERSION,
	computeEnvelopeStatus,
	type RetrieveResponseV1,
	type SliceSummary,
	toContractEntry,
} from "../../retrieval/contract.js";
import { RetrievalEngine } from "../../retrieval/engine.js";
import { redactEntriesForRetrieval } from "../../security/retrieval-redaction.js";
import type { MemoryType } from "../../types.js";
import { closeDb, collect, getDb, parseLevel } from "../context.js";

export function register(program: Command): void {
	program
		.command("retrieve")
		.description("Query memory for relevant knowledge (contract v1 envelope)")
		.argument("<query>", "Natural language query")
		.option("--layer <n>", "Disclosure layer (1|2|3 or L1|L2|L3)", "2")
		.option("--budget <tokens>", "Max token budget", "2000")
		.option("--limit <n>", "Max result count")
		.option("--low-trust", "Include low-trust entries (lower threshold, marked)")
		.option("--type <type>", "Filter by memory type (repeatable)", collect, [])
		.option("--repository <id>", "Filter by repository")
		.action(async (query, options) => {
			try {
				const sql = getDb();
				const entryRepo = new MemoryEntryRepository(sql);
				const engine = new RetrievalEngine(sql);
				const validated = await entryRepo.findByStatus("validated");
				const stale = await entryRepo.findByStatus("stale");
				const allEntries = [...validated, ...stale];
				const level = parseLevel(options.layer);
				const typeFilter = options.type as MemoryType[];
				const filters: { repository?: string; types?: MemoryType[] } = {};
				if (options.repository) filters.repository = options.repository;
				if (typeFilter.length > 0) filters.types = typeFilter;
				const chain = buildEmbeddingChain();
				const { vector: queryEmbedding } = await chain.embed(query);
				const result = await engine.retrieve(allEntries, {
					query,
					queryEmbedding,
					level,
					tokenBudget: Number.parseInt(options.budget, 10),
					limit: options.limit ? Number.parseInt(options.limit, 10) : undefined,
					filters: Object.keys(filters).length > 0 ? filters : undefined,
					lowTrustMode: !!options.lowTrust,
				});
				const rawContractEntries = result.entries.map((e) => toContractEntry(e));
				// III2 · Retrieval-Output-Filter — same safety net as MCP.
				const { entries: contractEntries, warnings } =
					redactEntriesForRetrieval(rawContractEntries);
				const slices: Record<string, SliceSummary> = {};
				if (typeFilter.length > 0) {
					for (const t of typeFilter) {
						slices[t] = {
							status: "ok",
							count: contractEntries.filter((e) => e.type === t).length,
						};
					}
				} else {
					slices["*"] = { status: "ok", count: contractEntries.length };
				}
				const envelope: RetrieveResponseV1 = {
					contract_version: CONTRACT_VERSION,
					status: computeEnvelopeStatus(slices, contractEntries.length),
					entries: contractEntries,
					slices,
					errors: [],
					...(warnings.length > 0 ? { warnings } : {}),
				};
				console.log(JSON.stringify({ ...envelope, metadata: result.metadata }, null, 2));
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
