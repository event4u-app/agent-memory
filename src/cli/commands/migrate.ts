import type { Command } from "commander";
import { closeDb } from "../context.js";

async function runMigrateUp(): Promise<void> {
	try {
		const { runMigrations } = await import("../../db/migrate.js");
		const result = await runMigrations();
		console.log(JSON.stringify({ status: "ok", ...result }, null, 2));
		await closeDb();
		process.exit(0);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		console.error(JSON.stringify({ status: "error", error: message }, null, 2));
		await closeDb();
		process.exit(1);
	}
}

async function runMigrateStatus(): Promise<void> {
	try {
		const { buildMigrationStatus } = await import("../../db/migrate.js");
		const status = await buildMigrationStatus();
		console.log(JSON.stringify({ status: "ok", ...status }, null, 2));
		await closeDb();
		process.exit(0);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		console.error(JSON.stringify({ status: "error", error: message }, null, 2));
		await closeDb();
		process.exit(1);
	}
}

export function register(program: Command): void {
	// `memory migrate` carries three subcommands plus a backwards-compatible
	// default action — existing consumers calling `memory migrate` keep getting
	// the apply-pending behavior.
	const migrateCmd = program
		.command("migrate")
		.description(
			"Database migrations — `up` (default) applies pending, `status` prints applied/pending as JSON",
		)
		.action(() => runMigrateUp());

	migrateCmd
		.command("up")
		.description("Apply every pending migration — safe to run repeatedly")
		.action(() => runMigrateUp());

	migrateCmd
		.command("status")
		.description("Report applied vs. pending migrations (JSON)")
		.action(() => runMigrateStatus());
}
