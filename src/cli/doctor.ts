// Environment diagnostics for `memory doctor`.
//
// Contract:
//   Input  — env vars (DATABASE_URL, REPO_ROOT), the DB schema from
//            migrations, and the optional agent-config symlinks under
//            node_modules/@event4u/agent-config.
//   Output — DoctorReport (JSON). Human summary is rendered separately
//            in src/cli/index.ts so this module stays side-effect-free
//            and testable.

import { existsSync, lstatSync, readdirSync, readlinkSync } from "node:fs";
import path from "node:path";
import type postgres from "postgres";

import { config } from "../config.js";
import { closeDb, getDb } from "../db/connection.js";

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
}

// Known migrations expected in memory_migrations; kept in sync with
// src/db/migrate.ts MIGRATIONS array. If you add one there, add it here.
const EXPECTED_MIGRATIONS = ["001_initial", "002_promotion_metadata"] as const;

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

export async function runDoctor(): Promise<DoctorReport> {
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

	const summary = { ok: 0, warn: 0, fail: 0, skip: 0 };
	for (const c of checks) summary[c.status]++;
	const status: DoctorReport["status"] =
		summary.fail > 0 ? "unhealthy" : summary.warn > 0 ? "warnings" : "healthy";
	return { status, checks, summary };
}

export function renderHuman(report: DoctorReport): string {
	const icon = { ok: "✅", warn: "⚠️ ", fail: "❌", skip: "⏭️ " } as const;
	const lines = [`memory doctor — ${report.status.toUpperCase()}`, "─".repeat(48)];
	for (const c of report.checks) {
		lines.push(`${icon[c.status]}  ${c.name.padEnd(22)} ${c.message}`);
	}
	lines.push("─".repeat(48));
	lines.push(
		`  ${report.summary.ok} ok · ${report.summary.warn} warn · ${report.summary.fail} fail · ${report.summary.skip} skipped`,
	);
	return lines.join("\n");
}
