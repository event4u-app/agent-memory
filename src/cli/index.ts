#!/usr/bin/env node
// Default to silent logger for CLI usage unless caller overrides.
// Must happen before any import that touches the logger (config/db).
process.env.LOG_LEVEL ??= "silent";

import { Command } from "commander";
import { isMainModule } from "../utils/is-main-module.js";
import { register as registerAudit } from "./commands/audit.js";
import { register as registerDiagnose } from "./commands/diagnose.js";
import { register as registerDoctor } from "./commands/doctor.js";
import { register as registerExplain } from "./commands/explain.js";
import { register as registerHealth } from "./commands/health.js";
import { register as registerIngest } from "./commands/ingest.js";
import { register as registerInit } from "./commands/init.js";
import { register as registerInvalidate } from "./commands/invalidate.js";
import { register as registerMcp } from "./commands/mcp.js";
import { register as registerMigrate } from "./commands/migrate.js";
import { register as registerPoison } from "./commands/poison.js";
import { register as registerPromote } from "./commands/promote.js";
import { register as registerPropose } from "./commands/propose.js";
import { register as registerRetrieve } from "./commands/retrieve.js";
import { register as registerRollback } from "./commands/rollback.js";
import { register as registerServe } from "./commands/serve.js";
import { register as registerStatus } from "./commands/status.js";
import { register as registerValidate } from "./commands/validate.js";
import { register as registerVerify } from "./commands/verify.js";
import { BACKEND_VERSION } from "./context.js";

// Re-exported for tests and scripts/check-cli-commands.ts that imported
// from the pre-A3 monolith. Keeps the public import path stable.
export { parseServePort } from "./context.js";

const program = new Command();

program
	.name("memory")
	.description("Agent Memory — persistent, trust-scored project knowledge")
	.version(BACKEND_VERSION);

// Order matches the pre-split command definitions — preserves --help output
// and scripts/check-cli-commands.ts ordering.
registerIngest(program);
registerRetrieve(program);
registerValidate(program);
registerInvalidate(program);
registerPoison(program);
registerRollback(program);
registerVerify(program);
registerPropose(program);
registerPromote(program);
registerHealth(program);
registerStatus(program);
registerDiagnose(program);
registerAudit(program);
registerExplain(program);
registerMigrate(program);
registerInit(program);
registerDoctor(program);
registerServe(program);
registerMcp(program);

// Only parse argv when invoked as a script. The generator in
// scripts/generate-cli-docs.ts imports `program` to introspect commands.
// isMainModule resolves symlinks so `/usr/local/bin/memory` in the
// Docker image (symlinked to /app/dist/cli/index.js) also triggers.
if (isMainModule(import.meta.url)) {
	program.parse();
}

export { program };
