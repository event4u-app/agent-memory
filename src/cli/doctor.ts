// Environment diagnostics for `memory doctor`.
//
// Contract:
//   Input  — env vars (DATABASE_URL, REPO_ROOT), the DB schema from
//            migrations, and the optional agent-config symlinks under
//            node_modules/@event4u/agent-config.
//   Output — DoctorReport (JSON). Human summary is rendered separately
//            in src/cli/index.ts so this module stays side-effect-free
//            and testable.

import { createHash } from "node:crypto";
import { existsSync, lstatSync, readdirSync, readFileSync, readlinkSync } from "node:fs";
import path from "node:path";
import type postgres from "postgres";

import { config, getProjectConfigStatus } from "../config.js";
import { closeDb, getDb } from "../db/connection.js";
import { INGRESS_INVENTORY } from "../security/ingress-inventory.js";
import { SECRET_PATTERNS } from "../security/secret-patterns.js";
import { redactLoggerOptions } from "../utils/logger.js";

export type CheckStatus = "ok" | "warn" | "fail" | "skip";

export interface DoctorCheck {
	name: string;
	status: CheckStatus;
	message: string;
	detail?: Record<string, unknown>;
}

export interface DoctorReport {
	status: "healthy" | "warnings" | "unhealthy";
	checks: DoctorCheck[];
	summary: { ok: number; warn: number; fail: number; skip: number };
	fixes?: DoctorFix[];
}

export type FixStatus = "applied" | "skipped" | "failed";

export interface DoctorFix {
	target: string;
	status: FixStatus;
	message: string;
	detail?: Record<string, unknown>;
}

// Known migrations expected in memory_migrations; kept in sync with
// src/db/migrate.ts MIGRATIONS array. If you add one there, add it here.
const EXPECTED_MIGRATIONS = [
	"001_initial",
	"002_promotion_metadata",
	"003_memory_events",
	"004_memory_events_trust_extension",
] as const;

async function checkEnv(): Promise<DoctorCheck> {
	const explicit = process.env.DATABASE_URL;
	if (!explicit) {
		return {
			name: "env.DATABASE_URL",
			status: "warn",
			message: "DATABASE_URL not set — falling back to the dev default. Export it in production.",
			detail: { using: config.database.url.replace(/\/\/.*@/, "//***@") },
		};
	}
	return {
		name: "env.DATABASE_URL",
		status: "ok",
		message: "DATABASE_URL is set.",
		detail: { url: explicit.replace(/\/\/.*@/, "//***@") },
	};
}

async function checkDbConnect(sql: postgres.Sql): Promise<DoctorCheck> {
	const start = Date.now();
	try {
		await sql`SELECT 1`;
		return {
			name: "db.connect",
			status: "ok",
			message: `Connected in ${Date.now() - start} ms.`,
			detail: { latencyMs: Date.now() - start },
		};
	} catch (err) {
		return {
			name: "db.connect",
			status: "fail",
			message: `Cannot reach Postgres: ${err instanceof Error ? err.message : String(err)}`,
		};
	}
}

async function checkPgvector(sql: postgres.Sql): Promise<DoctorCheck> {
	try {
		const rows = await sql<{ extversion: string }[]>`
			SELECT extversion FROM pg_extension WHERE extname = 'vector'
		`;
		if (rows.length === 0) {
			return {
				name: "db.pgvector",
				status: "fail",
				message:
					"pgvector extension not installed. Run `npm run db:migrate` or `CREATE EXTENSION vector` manually.",
			};
		}
		const version = rows[0]?.extversion ?? "unknown";
		return {
			name: "db.pgvector",
			status: "ok",
			message: `pgvector ${version} installed.`,
			detail: { version },
		};
	} catch (err) {
		return {
			name: "db.pgvector",
			status: "fail",
			message: `pg_extension query failed: ${err instanceof Error ? err.message : String(err)}`,
		};
	}
}

async function checkMigrations(sql: postgres.Sql): Promise<DoctorCheck> {
	try {
		const tableExists = await sql<{ exists: boolean }[]>`
			SELECT EXISTS (
				SELECT FROM information_schema.tables
				WHERE table_name = 'memory_migrations'
			) AS "exists"
		`;
		if (!tableExists[0]?.exists) {
			return {
				name: "db.migrations",
				status: "fail",
				message: "memory_migrations table missing. Run `npm run db:migrate`.",
			};
		}
		const applied = await sql<{ name: string }[]>`
			SELECT name FROM memory_migrations ORDER BY name
		`;
		const appliedNames = new Set(applied.map((r) => r.name));
		const missing = EXPECTED_MIGRATIONS.filter((m) => !appliedNames.has(m));
		if (missing.length > 0) {
			return {
				name: "db.migrations",
				status: "fail",
				message: `Pending migrations: ${missing.join(", ")}. Run \`npm run db:migrate\`.`,
				detail: { applied: [...appliedNames], pending: missing },
			};
		}
		return {
			name: "db.migrations",
			status: "ok",
			message: `All ${EXPECTED_MIGRATIONS.length} migrations applied.`,
			detail: { applied: [...appliedNames] },
		};
	} catch (err) {
		return {
			name: "db.migrations",
			status: "fail",
			message: `Query failed: ${err instanceof Error ? err.message : String(err)}`,
		};
	}
}

// agent-config is an OPTIONAL peer. Consumers that don't use the shared
// governance package are fine. This check therefore downgrades "not
// installed" to `skip`, never `fail`.
function checkAgentConfig(): DoctorCheck {
	const root = process.env.REPO_ROOT ?? process.cwd();
	const vendorDir = path.join(root, "node_modules", "@event4u", "agent-config");
	if (!existsSync(vendorDir)) {
		return {
			name: "agent-config",
			status: "skip",
			message: "@event4u/agent-config not installed (optional).",
		};
	}
	// The postinstall hook symlinks files from the vendor into .augment/.
	// Layout varies per area:
	//   .augment/commands/*.md                    → direct symlink to vendor
	//   .augment/skills/<name>/SKILL.md           → symlink (2 levels deep)
	// A healthy install = at least one descendant symlink points into the
	// vendor tree. We don't enforce completeness; that's install.sh's job.
	const dir = path.join(root, ".augment/commands");
	if (!existsSync(dir)) {
		return {
			name: "agent-config",
			status: "warn",
			message: ".augment/commands missing. Re-run `npm install`.",
		};
	}
	try {
		const children = readdirSync(dir);
		const linked = children.some((name) => {
			try {
				const child = path.join(dir, name);
				if (!lstatSync(child).isSymbolicLink()) return false;
				return readlinkSync(child).includes("@event4u/agent-config");
			} catch {
				return false;
			}
		});
		if (!linked) {
			return {
				name: "agent-config",
				status: "warn",
				message: ".augment/commands has no symlinks into vendor. Re-run `npm install`.",
			};
		}
	} catch (err) {
		return {
			name: "agent-config",
			status: "warn",
			message: `Cannot read .augment/commands: ${err instanceof Error ? err.message : String(err)}`,
		};
	}
	return {
		name: "agent-config",
		status: "ok",
		message: "agent-config symlinks intact.",
	};
}

// --- Secret-safety posture checks (roadmap IV2) ----------------------
// Static posture only — counts of secret events and last `audit
// secrets` run land here when IV1 (audit-event table) ships.

function checkSecretPolicy(): DoctorCheck {
	const policy = config.security.secretPolicy;
	if (policy === "redact") {
		return {
			name: "security.secretPolicy",
			status: "warn",
			message: "MEMORY_SECRET_POLICY=redact — ingress rejects are disabled. Default is reject.",
			detail: { policy },
		};
	}
	return {
		name: "security.secretPolicy",
		status: "ok",
		message: "Reject-by-default active (MEMORY_SECRET_POLICY=reject).",
		detail: { policy },
	};
}

function checkPatternCatalog(): DoctorCheck {
	const catalogPath = path.resolve(process.cwd(), "src/security/secret-patterns.ts");
	if (!existsSync(catalogPath)) {
		return {
			name: "security.patternCatalog",
			status: "skip",
			message:
				"Pattern catalog source not resolvable from cwd — running from an installed package.",
			detail: { patterns: SECRET_PATTERNS.length },
		};
	}
	const hash = createHash("sha256").update(readFileSync(catalogPath)).digest("hex").slice(0, 12);
	return {
		name: "security.patternCatalog",
		status: "ok",
		message: `${SECRET_PATTERNS.length} patterns loaded · catalog sha256:${hash}`,
		detail: { patterns: SECRET_PATTERNS.length, sha256Short: hash },
	};
}

function checkLoggerRedaction(): DoctorCheck {
	const paths = (redactLoggerOptions.redact as { paths: string[] } | undefined)?.paths ?? [];
	if (paths.length === 0) {
		return {
			name: "security.loggerRedaction",
			status: "fail",
			message: "Logger redact paths are empty — secrets may leak into log records.",
		};
	}
	return {
		name: "security.loggerRedaction",
		status: "ok",
		message: `Logger redacts ${paths.length} known-secret field paths.`,
		detail: { pathCount: paths.length },
	};
}

function checkEmbeddingBoundary(): DoctorCheck {
	const boundary = path.resolve(process.cwd(), "src/embedding/boundary.ts");
	const fallback = path.resolve(process.cwd(), "src/embedding/fallback-chain.ts");
	if (!existsSync(boundary) || !existsSync(fallback)) {
		return {
			name: "security.embeddingBoundary",
			status: "skip",
			message: "Boundary sources not resolvable from cwd (running outside the repo).",
		};
	}
	const wired = readFileSync(fallback, "utf8").includes('from "./boundary.js"');
	if (!wired) {
		return {
			name: "security.embeddingBoundary",
			status: "fail",
			message:
				"fallback-chain.ts no longer imports boundary — provider calls may bypass the guard.",
		};
	}
	return {
		name: "security.embeddingBoundary",
		status: "ok",
		message: "Embedding boundary wired · III4 drift-guard enforces no other provider path.",
	};
}

function checkIngressInventory(): DoctorCheck {
	if (INGRESS_INVENTORY.length === 0) {
		return {
			name: "security.ingressInventory",
			status: "fail",
			message:
				"Ingress inventory is empty — IV4 drift check will report every guard call as undeclared.",
		};
	}
	return {
		name: "security.ingressInventory",
		status: "ok",
		message: `${INGRESS_INVENTORY.length} ingress paths declared · IV4 drift-guard enforces bidirectional sync.`,
		detail: { surfaces: INGRESS_INVENTORY.map((p) => p.surface) },
	};
}

async function collectChecks(): Promise<DoctorCheck[]> {
	const checks: DoctorCheck[] = [];
	checks.push(await checkEnv());
	const sql = getDb();
	try {
		const connect = await checkDbConnect(sql);
		checks.push(connect);
		if (connect.status === "ok") {
			checks.push(await checkPgvector(sql));
			checks.push(await checkMigrations(sql));
		} else {
			checks.push({
				name: "db.pgvector",
				status: "skip",
				message: "Skipped — db.connect failed.",
			});
			checks.push({
				name: "db.migrations",
				status: "skip",
				message: "Skipped — db.connect failed.",
			});
		}
	} finally {
		await closeDb();
	}
	checks.push(checkAgentConfig());
	checks.push(checkProjectConfig());
	checks.push(checkSecretPolicy());
	checks.push(checkPatternCatalog());
	checks.push(checkLoggerRedaction());
	checks.push(checkEmbeddingBoundary());
	checks.push(checkIngressInventory());
	return checks;
}

// C1 · runtime-trust: verifies that `.agent-memory.yml` (if present)
// parsed and validated against `agent-memory-config-v1`. The import-time
// load in src/config.ts captured any error; we surface it here.
function checkProjectConfig(): DoctorCheck {
	const status = getProjectConfigStatus();
	if (status.error) {
		return {
			name: "project.config",
			status: "fail",
			message: status.error.message,
			detail: { path: status.path },
		};
	}
	if (!status.loaded) {
		return {
			name: "project.config",
			status: "skip",
			message: ".agent-memory.yml not found (optional).",
		};
	}
	return {
		name: "project.config",
		status: "ok",
		message: "Validated against agent-memory-config-v1.",
		detail: { path: status.path, repository: config.repository ?? null },
	};
}

function summarize(checks: DoctorCheck[]): DoctorReport {
	const summary = { ok: 0, warn: 0, fail: 0, skip: 0 };
	for (const c of checks) summary[c.status]++;
	const status: DoctorReport["status"] =
		summary.fail > 0 ? "unhealthy" : summary.warn > 0 ? "warnings" : "healthy";
	return { status, checks, summary };
}

// Auto-repair for the two checks the roadmap (A1) calls out — missing
// pgvector and unapplied migrations. Everything else stays a read-only
// diagnosis. Fixes requiring a reachable DB skip when db.connect fails.
export async function runRepairs(checks: DoctorCheck[]): Promise<DoctorFix[]> {
	const fixes: DoctorFix[] = [];
	const byName = new Map(checks.map((c) => [c.name, c] as const));
	const connect = byName.get("db.connect");
	if (connect?.status !== "ok") {
		return [
			{
				target: "db.connect",
				status: "skipped",
				message: "Cannot repair without a reachable database.",
			},
		];
	}

	const pgv = byName.get("db.pgvector");
	if (pgv?.status === "fail") {
		const sql = getDb();
		try {
			await sql`CREATE EXTENSION IF NOT EXISTS vector`;
			fixes.push({
				target: "db.pgvector",
				status: "applied",
				message: "CREATE EXTENSION IF NOT EXISTS vector",
			});
		} catch (err) {
			fixes.push({
				target: "db.pgvector",
				status: "failed",
				message: err instanceof Error ? err.message : String(err),
			});
		} finally {
			await closeDb();
		}
	}

	const mig = byName.get("db.migrations");
	if (mig?.status === "fail") {
		try {
			const { runMigrations } = await import("../db/migrate.js");
			const result = await runMigrations();
			fixes.push({
				target: "db.migrations",
				status: "applied",
				message: `Applied ${result.applied.length} migration(s).`,
				detail: { applied: result.applied, skipped: result.skipped },
			});
		} catch (err) {
			fixes.push({
				target: "db.migrations",
				status: "failed",
				message: err instanceof Error ? err.message : String(err),
			});
		} finally {
			await closeDb();
		}
	}

	return fixes;
}

export async function runDoctor(options: { fix?: boolean } = {}): Promise<DoctorReport> {
	const first = await collectChecks();
	if (!options.fix) return summarize(first);
	const fixes = await runRepairs(first);
	const attempted = fixes.some((f) => f.status === "applied" || f.status === "failed");
	if (!attempted) return { ...summarize(first), fixes };
	const second = await collectChecks();
	return { ...summarize(second), fixes };
}

export function renderHuman(report: DoctorReport): string {
	const icon = { ok: "✅", warn: "⚠️ ", fail: "❌", skip: "⏭️ " } as const;
	const width = Math.max(22, ...report.checks.map((c) => c.name.length));
	const lines = [`memory doctor — ${report.status.toUpperCase()}`, "─".repeat(width + 24)];
	for (const c of report.checks) {
		lines.push(`${icon[c.status]}  ${c.name.padEnd(width)} ${c.message}`);
	}
	lines.push("─".repeat(width + 24));
	lines.push(
		`  ${report.summary.ok} ok · ${report.summary.warn} warn · ${report.summary.fail} fail · ${report.summary.skip} skipped`,
	);
	if (report.fixes && report.fixes.length > 0) {
		const fixIcon = { applied: "🔧", skipped: "⏭️ ", failed: "❌" } as const;
		lines.push("", "repairs:");
		for (const f of report.fixes) {
			lines.push(`${fixIcon[f.status]}  ${f.target.padEnd(width)} ${f.message}`);
		}
	}
	return lines.join("\n");
}
