#!/usr/bin/env node
// Default to silent logger for CLI usage unless caller overrides.
// Must happen before any import that touches the logger (config/db).
process.env.LOG_LEVEL ??= "silent";

import { Command } from "commander";
import { closeDb, getDb, healthCheck } from "../db/connection.js";
import { BACKEND_FEATURES, CONTRACT_VERSION, type HealthResponseV1 } from "../retrieval/contract.js";

const BACKEND_VERSION = "0.1.0";
const HEALTH_TIMEOUT_MS = 2000;

const program = new Command();

program
  .name("memory")
  .description("Agent Memory — persistent, trust-scored project knowledge")
  .version(BACKEND_VERSION);

program
  .command("ingest")
  .description("Ingest knowledge from a repository or diff")
  .argument("[path]", "Path to repository or file", ".")
  .option("--from-diff <range>", "Extract from git diff (e.g., HEAD~1..HEAD)")
  .option("--dry-run", "Show what would be ingested without storing")
  .action(async (path, options) => {
    console.log("🔍 memory ingest — not yet implemented");
    console.log({ path, ...options });
  });

program
  .command("retrieve")
  .description("Query memory for relevant knowledge")
  .argument("<query>", "Natural language query")
  .option("--layer <n>", "Disclosure layer: 1=index, 2=timeline, 3=full", "1")
  .option("--budget <tokens>", "Max token budget", "2000")
  .option("--low-trust", "Include low-trust entries (⚠️ marker)")
  .option("--type <type>", "Filter by memory type")
  .option("--module <module>", "Filter by module")
  .action(async (query, options) => {
    console.log("🔍 memory retrieve — not yet implemented");
    console.log({ query, ...options });
  });

program
  .command("validate")
  .description("Validate a specific memory entry against current code")
  .argument("<id>", "Memory entry ID")
  .action(async (id) => {
    console.log("✅ memory validate — not yet implemented");
    console.log({ id });
  });

program
  .command("invalidate")
  .description("Mark entries as stale or invalidated")
  .option("--from-git-diff", "Invalidate entries affected by recent git changes")
  .option("--entry <id>", "Invalidate a specific entry")
  .option("--hard", "Hard invalidation (entry is completely wrong)")
  .action(async (options) => {
    console.log("❌ memory invalidate — not yet implemented");
    console.log(options);
  });

program
  .command("poison")
  .description("Mark an entry as confirmed wrong — triggers cascade review")
  .argument("<id>", "Memory entry ID")
  .argument("<reason>", "Why this entry is wrong")
  .action(async (id, reason) => {
    console.log("☠️ memory poison — not yet implemented");
    console.log({ id, reason });
  });

program
  .command("verify")
  .description("Trace a memory entry back to its source evidence")
  .argument("<id>", "Memory entry ID")
  .action(async (id) => {
    console.log("🔗 memory verify — not yet implemented");
    console.log({ id });
  });

program
  .command("health")
  .description("Probe backend health — returns contract v1 envelope as JSON")
  .option("--timeout <ms>", "Timeout in ms", String(HEALTH_TIMEOUT_MS))
  .action(async (options) => {
    const timeoutMs = Number.parseInt(options.timeout, 10) || HEALTH_TIMEOUT_MS;
    const envelope = await probeHealth(timeoutMs);
    console.log(JSON.stringify(envelope, null, 2));
    await closeDb();
    process.exit(envelope.status === "ok" ? 0 : 1);
  });

program
  .command("status")
  .description("Feature detection for consumers — prints present | absent | misconfigured")
  .option("--timeout <ms>", "Timeout in ms", String(HEALTH_TIMEOUT_MS))
  .option("--json", "Emit full JSON envelope (always exits 0)")
  .action(async (options) => {
    const timeoutMs = Number.parseInt(options.timeout, 10) || HEALTH_TIMEOUT_MS;
    const envelope = await probeHealth(timeoutMs);
    const memoryStatus: "present" | "absent" | "misconfigured" =
      envelope.status === "ok" ? "present" : "misconfigured";
    if (options.json) {
      console.log(JSON.stringify({ memory_status: memoryStatus, ...envelope }, null, 2));
    } else {
      console.log(memoryStatus);
    }
    await closeDb();
    process.exit(0);
  });

program
  .command("diagnose")
  .description("Identify issues: stale entries, contradictions, low trust")
  .action(async () => {
    console.log("🩺 memory diagnose — not yet implemented");
  });

async function probeHealth(timeoutMs: number): Promise<HealthResponseV1> {
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

program.parse();
