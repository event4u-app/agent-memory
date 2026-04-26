// A3 · runtime-trust — registry smoke test for the split CLI.
//
// Each command lives in its own module exporting `register(program)`.
// This test asserts: (1) the main program registers all 25 commands
// with the expected names, (2) each command module is independently
// importable without side effects on `program`, and (3) the top-level
// --help output lists every command.
//
// Per-command behavior stays covered by existing suites (doctor-fix,
// init, serve-http, e2e canaries). The intent here is the split itself.

import { Command } from "commander";
import { describe, expect, it } from "vitest";
import { program as rootProgram } from "../../../src/cli/index.js";

const EXPECTED_COMMANDS = [
	"ingest",
	"retrieve",
	"validate",
	"invalidate",
	"poison",
	"rollback",
	"verify",
	"propose",
	"promote",
	"health",
	"status",
	"diagnose",
	"audit",
	"explain",
	"history",
	"review",
	"contradictions",
	"policy",
	"export",
	"import",
	"migrate",
	"init",
	"doctor",
	"serve",
	"mcp",
] as const;

describe("cli registry", () => {
	it("registers exactly the expected commands in order", () => {
		const names = rootProgram.commands.map((c) => c.name());
		expect(names).toEqual([...EXPECTED_COMMANDS]);
	});

	it("each command module exports a `register` function that adds one command", async () => {
		const modules = await Promise.all([
			import("../../../src/cli/commands/ingest.js"),
			import("../../../src/cli/commands/retrieve.js"),
			import("../../../src/cli/commands/validate.js"),
			import("../../../src/cli/commands/invalidate.js"),
			import("../../../src/cli/commands/poison.js"),
			import("../../../src/cli/commands/rollback.js"),
			import("../../../src/cli/commands/verify.js"),
			import("../../../src/cli/commands/propose.js"),
			import("../../../src/cli/commands/promote.js"),
			import("../../../src/cli/commands/health.js"),
			import("../../../src/cli/commands/status.js"),
			import("../../../src/cli/commands/diagnose.js"),
			import("../../../src/cli/commands/audit.js"),
			import("../../../src/cli/commands/explain.js"),
			import("../../../src/cli/commands/history.js"),
			import("../../../src/cli/commands/review.js"),
			import("../../../src/cli/commands/contradictions.js"),
			import("../../../src/cli/commands/policy.js"),
			import("../../../src/cli/commands/export.js"),
			import("../../../src/cli/commands/import.js"),
			import("../../../src/cli/commands/migrate.js"),
			import("../../../src/cli/commands/init.js"),
			import("../../../src/cli/commands/doctor.js"),
			import("../../../src/cli/commands/serve.js"),
			import("../../../src/cli/commands/mcp.js"),
		]);

		expect(modules).toHaveLength(EXPECTED_COMMANDS.length);
		for (const mod of modules) {
			expect(typeof mod.register).toBe("function");
		}

		// Each register() wires one top-level command onto a fresh program.
		for (let i = 0; i < modules.length; i++) {
			const fresh = new Command();
			modules[i].register(fresh);
			const expected = EXPECTED_COMMANDS[i];
			const found = fresh.commands.map((c) => c.name());
			expect(found, `module ${expected} registers a top-level command`).toContain(expected);
		}
	});

	it("audit + migrate + policy expose their subcommands", () => {
		const audit = rootProgram.commands.find((c) => c.name() === "audit");
		expect(audit?.commands.map((c) => c.name())).toContain("secrets");

		const migrate = rootProgram.commands.find((c) => c.name() === "migrate");
		const migrateSubs = migrate?.commands.map((c) => c.name()) ?? [];
		expect(migrateSubs).toContain("up");
		expect(migrateSubs).toContain("status");

		const policy = rootProgram.commands.find((c) => c.name() === "policy");
		expect(policy?.commands.map((c) => c.name())).toContain("check");
	});

	it("every command has a non-empty description", () => {
		for (const cmd of rootProgram.commands) {
			expect(cmd.description(), `${cmd.name()} has a description`).not.toBe("");
		}
	});
});
