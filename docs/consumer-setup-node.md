# Consumer setup — Node / TypeScript

End-to-end guide for integrating `@event4u/agent-memory` into a Node
or TypeScript project. Three usage modes are supported:

1. **Programmatic import** — call the backend directly from your code.
2. **CLI** — shell out to the `memory` binary for JSON on stdout.
3. **MCP sidecar** — a stdio server your agent client connects to.

All three can coexist in the same project.

## Prerequisites

- Node ≥ 20 (ESM support + native `fetch`).
- PostgreSQL 15+ with the `pgvector` extension. Easiest option:
  [`examples/consumer-docker-compose.yml`](../examples/consumer-docker-compose.yml).

## 1 · Install

`agent-memory` is a development-time tool for most consumers — install it
as a dev dependency so it stays out of production bundles:

```bash
npm install --save-dev @event4u/agent-memory
```

Production-time callers (a service that queries its own memory at runtime)
can drop the `--save-dev` flag. Everything below works the same either way.

Migrations ship with the package. Run them once against an empty DB
via the published migration script:

```bash
DATABASE_URL=postgresql://memory:memory_dev@localhost:5433/agent_memory \
  node node_modules/@event4u/agent-memory/dist/db/migrate.js
```

> Until a dedicated `memory migrate` subcommand lands (tracked for v0.2),
> the ESM migration script is the supported path. Inside the repo,
> `npm run db:migrate` is the equivalent.

## 2 · Programmatic import

The package ships **two public entry points** via the `exports` map:

| Entry | Purpose |
|---|---|
| `@event4u/agent-memory` | Types, constants, DB connection, trust helpers, repositories |
| `@event4u/agent-memory/cli` | The Commander program — rarely needed directly |

### Recommended: shell out to the CLI

The end-to-end `retrieve` / `propose` / `promote` / `health` operations
live inside the CLI and MCP server. For v0.1, the most stable
programmatic path is to spawn the CLI and parse JSON:

```ts
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const run = promisify(execFile);

const { stdout } = await run("npx", [
  "memory", "retrieve",
  "how do orders work?",
  "--type", "architecture_decision",
  "--limit", "5",
]);
const memories = JSON.parse(stdout);
```

This avoids the overhead of keeping a DB connection alive inside your
app process and matches the stable CLI contract — any consumer (your
own code, `@event4u/agent-config`, a CI script) sees the same JSON
output shape.

### Advanced: repository-level access

The package also exports the low-level repositories for consumers that
need to run their own ingestion pipelines (embedding generation, custom
validation). The full entry interface is wider than the CLI surface:

```ts
import {
  getDb,
  closeDb,
  MemoryEntryRepository,
  type CreateEntryInput,
} from "@event4u/agent-memory";

const repo = new MemoryEntryRepository(getDb());

const input: CreateEntryInput = {
  type: "architecture_decision",
  title: "Use event sourcing for orders",
  summary: "All order state changes flow through domain events.",
  scope: { repository: "my-app", files: [], symbols: [], modules: [] },
  impactLevel: "normal",
  knowledgeClass: "semi_stable",
  embeddingText: "event sourcing orders aggregate domain events",
  createdBy: "app:ingestion-job",
};

const entry = await repo.create(input);   // starts in `quarantine`
console.log("proposed:", entry.id, "status:", entry.trust.status);

await closeDb();
```

See [`src/db/repositories/`](../src/db/repositories/) for the full
list. Note that calling `create()` directly bypasses the privacy
filter, duplicate check, and evidence-gate pipeline that `memory ingest`
runs — use this only when you own that pipeline yourself.

### Health check

```ts
import { healthCheck } from "@event4u/agent-memory";

const { ok, latencyMs } = await healthCheck();
if (!ok) throw new Error("agent-memory DB unreachable");
```

### TypeScript config

The package is ESM-only with full `.d.ts` bundles. Your
`tsconfig.json` should have:

```json
{
  "compilerOptions": {
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "target": "ES2022"
  }
}
```

Strict mode is recommended — the package ships its own strict types and
compiles cleanly under `"strict": true`.

## 3 · CLI fallback

For scripts, package-manager hooks (npm, Composer, …), or GitHub
Actions where import overhead isn't worth it:

```bash
# Retrieve
npx memory retrieve "how do orders work?" --limit 5

# Propose
npx memory ingest \
  --type architecture_decision \
  --title "Use event sourcing for orders" \
  --summary "All order state changes flow through domain events." \
  --repository my-app

# Health (JSON envelope on stdout, exit 0/1)
npx memory health
```

Full flag reference: [`docs/cli-reference.md`](cli-reference.md).

## 4 · MCP sidecar

For agent-facing use, the `memory mcp` subcommand starts a stdio MCP
server. Point your agent client at it:

```json
{
  "mcpServers": {
    "agent-memory": {
      "command": "memory",
      "args": ["mcp"],
      "env": {
        "DATABASE_URL": "postgresql://memory:memory_dev@localhost:5433/agent_memory",
        "REPO_ROOT": "/abs/path/to/your/project"
      }
    }
  }
}
```

Docker sidecar alternative: see
[`consumer-setup-docker-sidecar.md`](consumer-setup-docker-sidecar.md)
— the MCP config is language-agnostic.

## 5 · Migrations in your own app lifecycle

If your app owns the DB schema lifecycle, run the published migration
script from your deploy pipeline. The script is idempotent and safe to
run on every deploy:

```bash
DATABASE_URL=$DATABASE_URL \
  node node_modules/@event4u/agent-memory/dist/db/migrate.js
```

A stable `runMigrations` programmatic export is tracked for v0.2.
Until then, the shell command above is the contract. See
[`examples/consumer-ci.yml`](../examples/consumer-ci.yml) for a
GitHub Actions workflow that wires this into a full pipeline.
