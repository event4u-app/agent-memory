import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { getDb, closeDb } from "../db/connection.js";
import { MemoryEntryRepository } from "../db/repositories/memory-entry.repository.js";
import { EvidenceRepository } from "../db/repositories/evidence.repository.js";
import { ContradictionRepository } from "../db/repositories/contradiction.repository.js";
import { ObservationRepository } from "../db/repositories/observation.repository.js";
import { RetrievalEngine } from "../retrieval/engine.js";
import { QuarantineService } from "../trust/quarantine.service.js";
import { ContradictionService } from "../trust/contradiction.service.js";
import { PoisonService } from "../trust/poison.service.js";
import { FileExistsValidator } from "../trust/validators/file-exists.validator.js";
import { SymbolExistsValidator } from "../trust/validators/symbol-exists.validator.js";
import { DiffImpactValidator } from "../trust/validators/diff-impact.validator.js";
import { TestLinkedValidator } from "../trust/validators/test-linked.validator.js";
import { TtlExpiryJob } from "../invalidation/ttl-expiry-job.js";
import { RevalidationJob } from "../invalidation/revalidation-job.js";
import { InvalidationOrchestrator } from "../invalidation/orchestrator.js";
import { config } from "../config.js";
import { registerToolHandlers } from "./tools.js";
import { registerLifecycleHandlers } from "./lifecycle.js";

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
  const quarantineService = new QuarantineService(entryRepo, evidenceRepo, contradictionRepo, validators);
  const contradictionService = new ContradictionService(sql, contradictionRepo);
  const poisonService = new PoisonService(sql, entryRepo);
  const ttlExpiryJob = new TtlExpiryJob(sql, entryRepo);
  const revalidationJob = new RevalidationJob(sql, entryRepo, quarantineService);
  const invalidationOrchestrator = new InvalidationOrchestrator(sql, entryRepo, evidenceRepo);

  const server = new Server(
    { name: "agent-memory", version: BACKEND_VERSION },
    { capabilities: { tools: {}, logging: {} } },
  );

  const ctx = {
    sql, repoRoot, entryRepo, evidenceRepo, contradictionRepo, observationRepo,
    retrievalEngine, quarantineService, contradictionService, poisonService,
    ttlExpiryJob, revalidationJob, invalidationOrchestrator,
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

startMcpServer().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
