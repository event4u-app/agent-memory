# Consumer integration examples

Reference snippets for consumers (e.g. `@event4u/agent-config`) integrating
`@event4u/agent-memory`. See
[`agents/roadmaps/archive/from-agent-config/road-to-consumer-integration-guide.md`](../agents/roadmaps/archive/from-agent-config/road-to-consumer-integration-guide.md)
for the full contract.

## Files

| File | Purpose |
|---|---|
| `consumer-docker-compose.yml` | Minimal Postgres + pgvector service for local dev |
| `consumer-ci.yml` | GitHub Actions workflow: Postgres service + `memory status` / `memory health` smoke test |
| [`laravel-sidecar/`](laravel-sidecar/) | Full Docker-sidecar example with a PHP / Laravel host app |
| [`node-programmatic/`](node-programmatic/) | Node / TypeScript embedded usage — `runMigrations()` + programmatic retrieval |
| [`with-agent-config/`](with-agent-config/) | Paired setup with [`@event4u/agent-config`](https://github.com/event4u-app/agent-config); smoke-tested (P5-2) |

## Using these

Both files are **illustrative templates**, not drop-in packages. Copy, adapt,
and pin versions as needed. The contract these examples target:

- `DATABASE_URL` is read from env — consumer provides Postgres, this package
  does not provision infrastructure
- `memory status` exits 0 and prints `present | absent | misconfigured` on
  stdout — used by `agent-config` skills to branch gracefully
- `memory health` exits 0 on success, non-zero on any error — use this to
  gate deployments or warn in CI

## Compatibility matrix

See [`docs/compatibility-matrix.md`](../docs/compatibility-matrix.md)
for the full version matrix across runtime, contract, and companion
axes. Short version:

| `agent-memory` | `agent-config` | Node | Postgres |
|---|---|---|---|
| 1.0.x / 1.1.x | `main` (pre-1.0) | ≥ 20 | 15+ with pgvector |
