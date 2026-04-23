import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { closeDb, getDb } from "../db/connection.js";
import { ContradictionRepository } from "../db/repositories/contradiction.repository.js";
import { EvidenceRepository } from "../db/repositories/evidence.repository.js";
import { MemoryEntryRepository } from "../db/repositories/memory-entry.repository.js";
import { ObservationRepository } from "../db/repositories/observation.repository.js";
import { buildEmbeddingChain } from "../embedding/index.js";
import { InvalidationOrchestrator } from "../invalidation/orchestrator.js";
import { RevalidationJob } from "../invalidation/revalidation-job.js";
import { TtlExpiryJob } from "../invalidation/ttl-expiry-job.js";
import { RetrievalEngine } from "../retrieval/engine.js";
import { ContradictionService } from "../trust/contradiction.service.js";
import { PoisonService } from "../trust/poison.service.js";
import { PromotionService } from "../trust/promotion.service.js";
import { QuarantineService } from "../trust/quarantine.service.js";
import { DiffImpactValidator } from "../trust/validators/diff-impact.validator.js";
import { FileExistsValidator } from "../trust/validators/file-exists.validator.js";
import { SymbolExistsValidator } from "../trust/validators/symbol-exists.validator.js";
import { TestLinkedValidator } from "../trust/validators/test-linked.validator.js";
import { isMainModule } from "../utils/is-main-module.js";
import { registerLifecycleHandlers } from "./lifecycle.js";
import { registerToolHandlers } from "./tools.js";

const BACKEND_VERSION = "0.1.0";

export async function startMcpServer(): Promise<void> {
	const sql = getDb();

	const entryRepo = new MemoryEntryRepository(sql);
	const evidenceRepo = new EvidenceRepository(sql);
	const contradictionRepo = new ContradictionRepository(sql);
	const observationRepo = new ObservationRepository(sql);

	const repoRoot = process.env.REPO_ROOT ?? process.cwd();

	const validators = [
		new FileExistsValidator(repoRoot),
		new SymbolExistsValidator(repoRoot),
		new DiffImpactValidator(repoRoot),
		new TestLinkedValidator(repoRoot),
	];

	const retrievalEngine = new RetrievalEngine(sql);
	const quarantineService = new QuarantineService(
		entryRepo,
		evidenceRepo,
		contradictionRepo,
		validators,
	);
	const promotionService = new PromotionService(sql, entryRepo, quarantineService);
	const contradictionService = new ContradictionService(sql, contradictionRepo);
	const poisonService = new PoisonService(sql, entryRepo);
	const ttlExpiryJob = new TtlExpiryJob(sql, entryRepo);
	const revalidationJob = new RevalidationJob(sql, entryRepo, quarantineService);
	const invalidationOrchestrator = new InvalidationOrchestrator(sql, entryRepo, evidenceRepo);
	const embeddingChain = buildEmbeddingChain();

	const server = new Server(
		{ name: "agent-memory", version: BACKEND_VERSION },
		{ capabilities: { tools: {}, logging: {} } },
	);

	const ctx = {
		sql,
		repoRoot,
		entryRepo,
		evidenceRepo,
		contradictionRepo,
		observationRepo,
		retrievalEngine,
		quarantineService,
		promotionService,
		contradictionService,
		poisonService,
		ttlExpiryJob,
		revalidationJob,
		invalidationOrchestrator,
		embeddingChain,
		backendVersion: BACKEND_VERSION,
	};

	registerToolHandlers(server, ctx);
	registerLifecycleHandlers(server, ctx);

	const transport = new StdioServerTransport();
	await server.connect(transport);
	console.error("agent-memory MCP server running on stdio");

	process.on("SIGINT", async () => {
		console.error("Shutting down...");
		await closeDb();
		process.exit(0);
	});
}

// Resolve symlinks so the compiled server still triggers when invoked
// through a `bin` alias (see src/utils/is-main-module.ts).
if (isMainModule(import.meta.url)) {
	startMcpServer().catch((err) => {
		console.error("Fatal error:", err);
		process.exit(1);
	});
}
