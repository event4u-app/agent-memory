import type postgres from "postgres";
import type { MemoryEntryRepository } from "../db/repositories/memory-entry.repository.js";
import type { EvidenceRepository } from "../db/repositories/evidence.repository.js";
import type { ContradictionRepository } from "../db/repositories/contradiction.repository.js";
import type { ObservationRepository } from "../db/repositories/observation.repository.js";
import type { RetrievalEngine } from "../retrieval/engine.js";
import type { QuarantineService } from "../trust/quarantine.service.js";
import type { ContradictionService } from "../trust/contradiction.service.js";
import type { PoisonService } from "../trust/poison.service.js";
import type { TtlExpiryJob } from "../invalidation/ttl-expiry-job.js";
import type { RevalidationJob } from "../invalidation/revalidation-job.js";
import type { InvalidationOrchestrator } from "../invalidation/orchestrator.js";

export interface McpContext {
  sql: postgres.Sql;
  repoRoot: string;
  entryRepo: MemoryEntryRepository;
  evidenceRepo: EvidenceRepository;
  contradictionRepo: ContradictionRepository;
  observationRepo: ObservationRepository;
  retrievalEngine: RetrievalEngine;
  quarantineService: QuarantineService;
  contradictionService: ContradictionService;
  poisonService: PoisonService;
  ttlExpiryJob: TtlExpiryJob;
  revalidationJob: RevalidationJob;
  invalidationOrchestrator: InvalidationOrchestrator;
  /** Package version advertised via health contract */
  backendVersion: string;
}
