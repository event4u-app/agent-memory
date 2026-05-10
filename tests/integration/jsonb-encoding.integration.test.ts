// Regression test for the JSONB double-encoding bug fixed by migration 005
// and the `sql.json(...)` rewrite of the JSONB bind sites in
// memory-entry.repository, memory-event.repository and import-service.
//
// Gated on TEST_DATABASE_URL — when unset the suite is skipped so unit-only
// runs (and CI without Postgres) stay green. Set the env var to a Postgres
// instance with pgvector and migrations already applied:
//
//   TEST_DATABASE_URL=postgresql://memory:memory_dev@localhost:5433/agent_memory \
//     npm test -- tests/integration/jsonb-encoding.integration.test.ts

import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runMigrations } from "../../src/db/migrate.js";
import { MemoryEntryRepository } from "../../src/db/repositories/memory-entry.repository.js";
import { MemoryEventRepository } from "../../src/db/repositories/memory-event.repository.js";

const url = process.env.TEST_DATABASE_URL;
const REPO = `acme/jsonb-regression-${Date.now()}`;

const describeIfDb = url ? describe : describe.skip;

describeIfDb("JSONB encoding round-trip (DB-touching)", () => {
	let sql: postgres.Sql;
	let entryRepo: MemoryEntryRepository;
	let eventRepo: MemoryEventRepository;

	beforeAll(async () => {
		sql = postgres(url ?? "", {
			max: 5,
			idle_timeout: 10,
			connect_timeout: 10,
			onnotice: () => {},
		});
		await runMigrations({ sql });
		eventRepo = new MemoryEventRepository(sql);
		entryRepo = new MemoryEntryRepository(sql, eventRepo);
	});

	afterAll(async () => {
		if (sql) {
			// Scope cleanup to this test run so we never touch unrelated rows.
			await sql`
				DELETE FROM memory_entries
				WHERE scope->>'repository' = ${REPO}
			`;
			await sql.end();
		}
	});

	it("propose() stores scope and promotion_metadata as JSONB objects", async () => {
		const entry = await entryRepo.create({
			type: "coding_convention",
			title: "JSONB regression probe",
			summary: "ensures sql.json binds as object not string",
			scope: { repository: REPO, files: ["src/foo.ts"], symbols: [], modules: [] },
			impactLevel: "normal",
			knowledgeClass: "semi_stable",
			embeddingText: "probe",
			createdBy: "integration-test",
			promotionMetadata: { source: "test", run_id: "regression-1" },
		});

		const [row] = await sql<
			{ scope_type: string; pm_type: string; repository: string; source: string }[]
		>`
			SELECT
				jsonb_typeof(scope) AS scope_type,
				jsonb_typeof(promotion_metadata) AS pm_type,
				scope->>'repository' AS repository,
				promotion_metadata->>'source' AS source
			FROM memory_entries
			WHERE id = ${entry.id}
		`;

		// The bug stored these as `string`; the fix lands them as `object`,
		// which is what makes `scope->>'repository'` and `promotion_metadata->>'source'`
		// return the actual values rather than NULL.
		expect(row?.scope_type).toBe("object");
		expect(row?.pm_type).toBe("object");
		expect(row?.repository).toBe(REPO);
		expect(row?.source).toBe("test");
	});

	it("event repository stores metadata/before/after as JSONB objects", async () => {
		const event = await eventRepo.record({
			actor: "integration-test",
			eventType: "trust_promoted",
			metadata: { reason: "regression-probe" },
			before: { status: "quarantine", score: 0.2 },
			after: { status: "validated", score: 0.8 },
			reason: "Regression probe",
		});

		const [row] = await sql<
			{ md_type: string; before_type: string; after_type: string; reason: string }[]
		>`
			SELECT
				jsonb_typeof(metadata) AS md_type,
				jsonb_typeof(before)   AS before_type,
				jsonb_typeof(after)    AS after_type,
				metadata->>'reason'    AS reason
			FROM memory_events
			WHERE id = ${event.id}
		`;

		expect(row?.md_type).toBe("object");
		expect(row?.before_type).toBe("object");
		expect(row?.after_type).toBe("object");
		expect(row?.reason).toBe("regression-probe");
	});

	it("migration 005 repairs pre-existing JSONB string rows", async () => {
		// Inject a row in the broken shape (the pattern the old code produced)
		// directly via raw SQL — this simulates a row written by a pre-fix
		// build that the migration must heal on the next deploy.
		const probeId = "00000000-0000-4000-8000-000000005005";
		const broken = JSON.stringify({ repository: REPO, files: [], symbols: [], modules: [] });
		await sql`
			INSERT INTO memory_entries (
				id, type, title, summary, scope, impact_level, knowledge_class,
				consolidation_tier, embedding_text, trust_status, trust_score,
				expires_at, created_by, promotion_metadata
			) VALUES (
				${probeId}, 'coding_convention', 'broken probe', '-',
				${broken}::jsonb, 'normal', 'semi_stable', 'semantic', '-',
				'quarantine', 0.0, NOW() + INTERVAL '30 days',
				'integration-test', '"{}"'::jsonb
			)
		`;

		// Verify the row is in the broken shape before repair.
		const [pre] = await sql<{ t: string }[]>`
			SELECT jsonb_typeof(scope) AS t FROM memory_entries WHERE id = ${probeId}
		`;
		expect(pre?.t).toBe("string");

		// Re-run migrations — 005 is idempotent and repairs in-place.
		const { up } = await import("../../src/db/migrations/005_repair_jsonb_strings.js");
		await up(sql);

		const [post] = await sql<{ t: string; repo: string }[]>`
			SELECT jsonb_typeof(scope) AS t, scope->>'repository' AS repo
			FROM memory_entries WHERE id = ${probeId}
		`;
		expect(post?.t).toBe("object");
		expect(post?.repo).toBe(REPO);
	});
});
