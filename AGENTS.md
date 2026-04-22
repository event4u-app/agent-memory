# @event4u/agent-memory

Persistent, trust-scored project memory for AI coding agents — MCP server + CLI, backed by PostgreSQL + pgvector.

## What this repo IS

- A **TypeScript / Node ≥ 20** library that implements a memory store for AI coding agents
- A **CLI** (`memory`) for scripts, CI, and IDE agents without MCP support
- An **MCP server** (stdio transport) exposing 17 tools for memory retrieval, ingestion, and management
- A **companion** to [`@event4u/agent-config`](https://github.com/event4u-app/agent-config) — optional dependency, governance and behavior

## What this repo is NOT

- **Not** a web application, UI, or SaaS service
- **Not** a dataset or pretrained model
- **Not** Laravel / PHP / MariaDB — if you see those references, they are stale and should be corrected
- **Not** a general-purpose vector database — it is specifically about agent-facing project knowledge with trust scoring, decay, and invalidation

## Tech Stack

- **Language:** TypeScript (strict mode), ES modules
- **Runtime:** Node ≥ 20
- **Package manager:** npm (lockfile: `package-lock.json`)
- **Database:** PostgreSQL 15+ with the `pgvector` extension
- **Testing:** Vitest (unit + integration), 176 tests passing
- **Lint:** Biome
- **Protocol:** Model Context Protocol (MCP) v1 via `@modelcontextprotocol/sdk`

## Agent Infrastructure

| Layer | Location | Purpose |
|---|---|---|
| **Shared package** | `.augment/` | Skills, rules, commands, guidelines from `@event4u/agent-config` (mostly symlinked) |
| **Project docs** | `agents/` | Architecture docs, ADRs, roadmaps specific to this package |
| **Integration specs** | `agents/roadmaps/from-agent-config/` | Contracts between this repo and agent-config |

### Key References

| What | Where |
|---|---|
| Behavior rules | `.augment/rules/` (always active — real copies, may contain project overrides) |
| Skills (on-demand) | `.augment/skills/` (symlinked from vendor) |
| Commands | `.augment/commands/` (symlinked from vendor) |
| Architecture ADR | `agents/adrs/0001-agent-memory-architecture.md` |
| Main roadmap | `agents/roadmaps/agent-memory-hybrid.md` |

## Development Setup

All commands run on the host (no Docker container for development — only PostgreSQL runs in Docker).

```bash
# 1. Start Postgres with pgvector
docker compose up -d postgres

# 2. Install dependencies
npm install

# 3. Run migrations
npm run db:migrate

# 4. Run tests
npm test

# 5. Start MCP server (stdio transport)
npm run mcp:start

# 6. Or use CLI directly
npx tsx src/cli/index.ts retrieve "how are invoices calculated?"
npx tsx src/cli/index.ts health
```

### Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `DATABASE_URL` | `postgresql://memory:memory_dev@localhost:5433/agent_memory` | Postgres connection |
| `REPO_ROOT` | `process.cwd()` | Repository root for file/symbol validators |
| `MEMORY_TRUST_THRESHOLD_DEFAULT` | `0.6` | Minimum trust score for retrieval |
| `MEMORY_TOKEN_BUDGET` | `2000` | Default token budget for retrieval |
| `LOG_LEVEL` | `info` | `debug` / `info` / `warn` / `error` |

See `README.md` → Configuration for the full list.

## Project Structure

```
src/
├── config.ts            # Configuration with env var overrides
├── types.ts             # Core types, enums, trust lifecycle
├── db/                  # Postgres connection, migrations, repositories
├── retrieval/           # BM25 + vector + RRF + progressive disclosure
├── trust/               # Scoring, transitions, validators, quarantine, poison
├── ingestion/           # Privacy filter, scanners, extraction guard, pipeline
├── consolidation/       # Working → Episodic → Semantic tier promotion
├── invalidation/        # Git diff, semantic drift, TTL expiry
├── quality/             # Metrics, dedup, contradiction resolution, archival
├── security/            # Access scopes
├── mcp/                 # MCP server (stdio), 17 tools
└── cli/                 # Commander-based CLI
```

## Public API surface (consumed by agent-config)

See `agents/roadmaps/from-agent-config/road-to-retrieval-contract.md` for the full v1 contract.

| API | Purpose |
|---|---|
| `retrieve(types, keys, limit, timeout_ms)` | Query with progressive disclosure |
| `propose(entry, type, source, confidence)` | Create quarantined entry |
| `promote(proposal_id)` | Promote quarantined → validated (gate criteria) |
| `deprecate(id, reason, superseded_by?)` | Mark entry as deprecated |
| `health(timeout_ms)` | `{ contract_version, status, backend_version, features[] }` |
| `prune(policy)` | Run archival / purge |

All available via CLI, MCP tools, and programmatic import.

## Scripts the agent should run

| Task | Command |
|---|---|
| Run tests | `npm test` |
| Type check | `npm run typecheck` |
| Lint | `npm run lint` (auto-fix: `npm run lint:fix`) |
| Build | `npm run build` |
| DB migrate | `npm run db:migrate` |
| Start MCP | `npm run mcp:start` |
| Start Postgres | `docker compose up -d postgres` |

## Relationship to `@event4u/agent-config`

- `agent-config` = behavior, governance, rules, skills (source of truth for `.augment/rules/*`)
- `agent-memory` (this repo) = persistence, retrieval, trust scoring, decay
- This repo **consumes** `agent-config` via `postinstall` → symlinks `.augment/skills/`, `.augment/commands/`, etc.
- `.augment/rules/` in this repo are **real copies** (tracked in git) so project-specific rules remain possible

## Additional Documentation

| Document | Topic |
|---|---|
| `README.md` | User-facing overview, MCP tool list, configuration |
| `agents/roadmaps/agent-memory-hybrid.md` | Full implementation roadmap (phases 0-10) |
| `agents/roadmaps/from-agent-config/` | Integration contracts authored by agent-config |
| `.augment/contexts/` | Shared agent infrastructure docs (symlinked from vendor) |
