// A3 · runtime-trust — shared wiring for CLI command modules.
//
// Each command in `src/cli/commands/` builds its own DB handle/services
// on-demand (CLI invocations are one-shot). This module bundles the
// repetitive wiring so command files stay focused on argument parsing
// and the user-visible JSON envelope.

import { closeDb, getDb, healthCheck } from "../db/connection.js";
import { ContradictionRepository } from "../db/repositories/contradiction.repository.js";
import { EvidenceRepository } from "../db/repositories/evidence.repository.js";
import { MemoryEntryRepository } from "../db/repositories/memory-entry.repository.js";
import { MemoryEventRepository } from "../db/repositories/memory-event.repository.js";
import {
	BACKEND_FEATURES,
	CONTRACT_VERSION,
	type HealthResponseV1,
} from "../retrieval/contract.js";
import type { DisclosureLevel } from "../retrieval/progressive-disclosure.js";
import { PromotionService } from "../trust/promotion.service.js";
import { QuarantineService } from "../trust/quarantine.service.js";
import { DiffImpactValidator } from "../trust/validators/diff-impact.validator.js";
import { FileExistsValidator } from "../trust/validators/file-exists.validator.js";
import { SymbolExistsValidator } from "../trust/validators/symbol-exists.validator.js";
import { TestLinkedValidator } from "../trust/validators/test-linked.validator.js";

export const BACKEND_VERSION = "0.1.0";
export const HEALTH_TIMEOUT_MS = 2000;

/** Commander option collector — preserves option order across repeats. */
export const collect = (value: string, previous: string[]): string[] => [...previous, value];

export { closeDb, getDb };

export function buildQuarantineService(): QuarantineService {
	const sql = getDb();
	// B4: entryRepo wires eventRepo for trust-audit emissions. All
	// transitionStatus() calls inside QuarantineService now write a
	// memory_events row in addition to memory_status_history.
	const eventRepo = new MemoryEventRepository(sql);
	const entryRepo = new MemoryEntryRepository(sql, eventRepo);
	const evidenceRepo = new EvidenceRepository(sql);
	const contradictionRepo = new ContradictionRepository(sql);
	const repoRoot = process.env.REPO_ROOT ?? process.cwd();
	const validators = [
		new FileExistsValidator(repoRoot),
		new SymbolExistsValidator(repoRoot),
		new DiffImpactValidator(repoRoot),
		new TestLinkedValidator(repoRoot),
	];
	return new QuarantineService(entryRepo, evidenceRepo, contradictionRepo, validators);
}

export function buildPromotionService(): PromotionService {
	const sql = getDb();
	const eventRepo = new MemoryEventRepository(sql);
	const entryRepo = new MemoryEntryRepository(sql, eventRepo);
	const quarantine = buildQuarantineService();
	return new PromotionService(sql, entryRepo, quarantine, eventRepo);
}

export function parseLevel(input: string): DisclosureLevel {
	const normalized = input.toLowerCase();
	if (normalized === "l1" || normalized === "1" || normalized === "index") return "index";
	if (normalized === "l2" || normalized === "2" || normalized === "timeline") return "timeline";
	if (normalized === "l3" || normalized === "3" || normalized === "full") return "full";
	throw new Error(`Invalid layer: ${input}. Expected 1|2|3 or L1|L2|L3 or index|timeline|full.`);
}

export async function probeHealth(timeoutMs: number): Promise<HealthResponseV1> {
	const start = Date.now();
	try {
		getDb();
		const result = await Promise.race([
			healthCheck(),
			new Promise<{ ok: false; latencyMs: number }>((resolve) =>
				setTimeout(() => resolve({ ok: false, latencyMs: timeoutMs }), timeoutMs),
			),
		]);
		return {
			contract_version: CONTRACT_VERSION,
			status: result.ok ? "ok" : "error",
			backend_version: BACKEND_VERSION,
			features: [...BACKEND_FEATURES],
			latency_ms: result.latencyMs,
		};
	} catch {
		return {
			contract_version: CONTRACT_VERSION,
			status: "error",
			backend_version: BACKEND_VERSION,
			features: [...BACKEND_FEATURES],
			latency_ms: Date.now() - start,
			counts: { error: 1 },
		};
	}
}

/**
 * Parse MEMORY_HTTP_PORT into a listening port or null. Empty / unset → null
 * (HTTP surface disabled). Non-numeric, out-of-range, or zero → null with
 * the raw value preserved in the log for debugging.
 */
export function parseServePort(raw: string | undefined): number | null {
	if (raw == null) return null;
	const trimmed = raw.trim();
	if (trimmed === "") return null;
	const n = Number.parseInt(trimmed, 10);
	if (!Number.isFinite(n) || n < 1 || n > 65535) return null;
	return n;
}
