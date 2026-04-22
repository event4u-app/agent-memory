# Example — Node programmatic

Minimal TypeScript project that uses `@event4u/agent-memory` both via
the CLI (shell-out) and via the programmatic repository API.

## What it shows

| Section | Pattern | Good for |
|---|---|---|
| 1. `proposeViaCli` | `execFile("npx", ["memory", "ingest", …])` | Full CLI contract (validators, privacy filter) |
| 2. `retrieveViaCli` | `execFile("npx", ["memory", "retrieve", …])` | Progressive disclosure + trust scoring |
| 3. `proposeViaRepository` | `MemoryEntryRepository.create()` | In-process ingestion; you own validation |

## Run it

```bash
# 1. Install dependencies (picks up @event4u/agent-memory from the
#    monorepo or npm registry depending on how you linked).
npm install

# 2. Point at your Postgres + repository.
cp .env.example .env
# Edit .env: DATABASE_URL, REPO_ROOT
export $(grep -v '^#' .env | xargs)

# 3. Run migrations once (if the DB is fresh):
node ./node_modules/@event4u/agent-memory/dist/db/migrate.js

# 4. Run the example.
npm start
```

Expected output (abbreviated):

```
=== 1. Propose via CLI (happy path) ===
  ✓ CLI ingest → id=abc12345-… status=quarantine

=== 2. Retrieve via CLI ===
  ✓ CLI retrieve → 1 entries
      abc12345  trust=0.40  Use ESM throughout the worker pipeline

=== 3. Propose via repository (advanced) ===
  ✓ Repository create → id=def67890  status=quarantine

Done.
```

## TypeScript

`tsc --strict` compiles cleanly against `@event4u/agent-memory`'s
bundled `.d.ts` files. The `tsconfig.json` here mirrors the minimum
config needed:

```json
{
  "compilerOptions": {
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true
  }
}
```

## When to use which pattern

- **CLI shell-out** — default. Hits the full ingestion pipeline
  (privacy filter, duplicate check, evidence-gate preparation) and
  returns the contract-v1 JSON envelope. Robust against backend
  changes because the CLI is a stable contract.
- **Repository access** — only when you need to run your own
  ingestion (custom embeddings, bulk imports, sync from external
  sources). You lose the CLI's validation pipeline.

See [`docs/consumer-setup-node.md`](../../docs/consumer-setup-node.md)
for the full guide including MCP sidecar configuration.
