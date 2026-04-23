import type postgres from "postgres";
import type { ContradictionRepository } from "../db/repositories/contradiction.repository.js";
import type { EvidenceRepository } from "../db/repositories/evidence.repository.js";
import type { MemoryEntryRepository } from "../db/repositories/memory-entry.repository.js";
import type { MemoryEventRepository } from "../db/repositories/memory-event.repository.js";
import type { ObservationRepository } from "../db/repositories/observation.repository.js";
import type { EmbeddingFallbackChain } from "../embedding/index.js";
import type { InvalidationOrchestrator } from "../invalidation/orchestrator.js";
import type { RevalidationJob } from "../invalidation/revalidation-job.js";
import type { TtlExpiryJob } from "../invalidation/ttl-expiry-job.js";
import type { RetrievalEngine } from "../retrieval/engine.js";
import type { ContradictionService } from "../trust/contradiction.service.js";
import type { PoisonService } from "../trust/poison.service.js";
import type { PromotionService } from "../trust/promotion.service.js";
import type { QuarantineService } from "../trust/quarantine.service.js";

export interface McpContext {
	sql: postgres.Sql;
	repoRoot: string;
	entryRepo: MemoryEntryRepository;
	evidenceRepo: EvidenceRepository;
	contradictionRepo: ContradictionRepository;
	observationRepo: ObservationRepository;
	/**
	 * Optional secret-safety audit recorder. When undefined, ingress guards
	 * still reject/redact but emit no persistent event — keeps unit tests
	 * with ad-hoc mock contexts simple. Production paths (startMcpServer,
	 * buildPromotionService in the CLI) always wire the real repository.
	 */
	eventRepo?: MemoryEventRepository;
	retrievalEngine: RetrievalEngine;
	quarantineService: QuarantineService;
	promotionService: PromotionService;
	contradictionService: ContradictionService;
	poisonService: PoisonService;
	ttlExpiryJob: TtlExpiryJob;
	revalidationJob: RevalidationJob;
	invalidationOrchestrator: InvalidationOrchestrator;
	embeddingChain: EmbeddingFallbackChain;
	/** Package version advertised via health contract */
	backendVersion: string;
}
