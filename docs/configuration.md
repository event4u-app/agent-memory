# Configuration

All settings are driven by environment variables, with safe defaults. Nothing
needs to be set to run locally — defaults match the bundled `docker-compose.yml`.

Full schema in [`src/config.ts`](../src/config.ts).

## Database

| Variable | Default | Notes |
|---|---|---|
| `DATABASE_URL` | `postgresql://memory:memory_dev@localhost:5433/agent_memory` | Primary DB |
| `DATABASE_URL_TEST` | `postgresql://memory:memory_dev@localhost:5434/agent_memory_test` | Used by `npm test` |

Both require **PostgreSQL 15+** with the `pgvector` extension. The bundled
`docker-compose.yml` provides a ready instance on port `5433`.

## Embedding provider

`agent-memory` degrades gracefully if no API key is set — retrieval falls back
to pure BM25 (keyword) search.

| Variable | Default | Notes |
|---|---|---|
| `EMBEDDING_PROVIDER` | `bm25-only` | one of `bm25-only \| openai \| gemini \| voyage \| local` |
| `OPENAI_API_KEY` | — | required for `openai` provider |
| `GEMINI_API_KEY` | — | required for `gemini` provider |
| `VOYAGE_API_KEY` | — | required for `voyage` provider |

The fallback chain is:

```
primary provider → retry with backoff → circuit breaker trips → bm25-only
```

See [`src/embedding/fallback-chain.ts`](../src/embedding/fallback-chain.ts).

## Trust scoring

| Variable | Default | Range | Notes |
|---|---|---|---|
| `MEMORY_TRUST_THRESHOLD_DEFAULT` | `0.6` | `0.0–1.0` | entries below this are not served |
| `MEMORY_TRUST_THRESHOLD_LOW` | `0.3` | `0.0–1.0` | threshold when retrieval uses `--low-trust` |

## Retrieval

| Variable | Default | Notes |
|---|---|---|
| `MEMORY_TOKEN_BUDGET` | `2000` | max tokens per retrieval response (L1 + L2 + L3 combined) |

## Archival

| Variable | Default | Notes |
|---|---|---|
| `MEMORY_ARCHIVAL_AGE_DAYS` | `30` | days from `invalidated` → `archived` |
| `MEMORY_PURGE_AGE_DAYS` | `90` | days from `archived` → hard-deleted |

## Invalidation batches

| Variable | Default | Notes |
|---|---|---|
| `MEMORY_MAX_INVALIDATION_BATCH` | `500` | cap entries touched per invalidation run |
| `MEMORY_MAX_REVALIDATION_BATCH` | `20` | cap entries re-checked per revalidation run |

## Logging

| Variable | Default | Notes |
|---|---|---|
| `LOG_LEVEL` | `info` (CLI: `silent`) | `debug \| info \| warn \| error \| silent` |
| `LOG_FORMAT` | `json` | `json \| pretty` |

CLI commands default to `silent` so stdout stays pure JSON. Override with
`LOG_LEVEL=debug` to inspect internals.

## Repository scope

| Variable | Default | Notes |
|---|---|---|
| `REPO_ROOT` | `process.cwd()` | root for file-exists / symbol-exists / diff validators |

Set this in every MCP config entry — the validators need absolute paths.

## MCP server

Two transports are available. `stdio` is the default and needs no
configuration beyond `DATABASE_URL`. `sse` adds an HTTP listener —
see [`docs/mcp-http.md`](mcp-http.md) for client configs.

| Variable | Default | Notes |
|---|---|---|
| `MEMORY_MCP_AUTH_TOKEN` | — | **Required** when starting with `--transport sse`. Static bearer token enforced on every `/sse` GET and `/message` POST. Rotate by redeploying. The server refuses to start when empty. |

```bash
memory mcp                                   # stdio (default)
memory mcp --transport sse --port 7078       # HTTP/SSE listener
```

## Database migrations

| Variable | Default | Notes |
|---|---|---|
| `MEMORY_AUTO_MIGRATE` | `true` (Docker image) | When `true` the container entrypoint runs `memory migrate` on startup. Idempotent. Set to `false` for ephemeral CLI containers or when migrations are managed externally (e.g. CI job). Has no effect outside the Docker image; host installs run `memory migrate` or `npm run db:migrate` manually. |

## Decay calibration

Per-type decay overrides via `MEMORY_DECAY_OVERRIDES` — JSON blob merged over
the defaults in [`src/trust/decay.ts`](../src/trust/decay.ts).

```bash
MEMORY_DECAY_OVERRIDES='{
  "perType": {
    "architecture_decision": { "halfLifeDays": null, "refreshBoost": 0.0 },
    "bug_pattern":           { "halfLifeDays": 60,   "refreshBoost": 0.15 },
    "deployment_warning":    { "halfLifeDays": 14,   "refreshBoost": 0.25 }
  }
}'
```

- `halfLifeDays: null` → no decay (use for ADRs / evergreen entries).
- `refreshBoost` is added to `trust_score` on retrieval hit, capped at `1.0`.
- Invalid JSON falls back to defaults; a warning is written to stderr at startup.

## Example `.env` for local dev

```bash
DATABASE_URL=postgresql://memory:memory_dev@localhost:5433/agent_memory
REPO_ROOT=/path/to/your/project
EMBEDDING_PROVIDER=openai
OPENAI_API_KEY=sk-...
MEMORY_TRUST_THRESHOLD_DEFAULT=0.6
LOG_LEVEL=info
```

## Example `.env` for CI

```bash
DATABASE_URL=postgresql://memory:memory_dev@postgres:5432/agent_memory
REPO_ROOT=${GITHUB_WORKSPACE}
EMBEDDING_PROVIDER=bm25-only        # avoid paid calls in CI
LOG_LEVEL=warn
LOG_FORMAT=json
```

See [`examples/consumer-ci.yml`](../examples/consumer-ci.yml) for a full
GitHub Actions workflow.
