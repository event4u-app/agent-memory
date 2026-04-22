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

See the top-level [`README.md`](../README.md#compatibility) for the full
version matrix. Short version:

| `agent-memory` | `agent-config` | Node | Postgres |
|---|---|---|---|
| 0.1.x | ≥ 0.1 (main) | ≥ 20 | 15+ with pgvector |
