# @event4u/agent-memory

Persistent, trust-scored project memory for AI coding agents — MCP server + CLI,
backed by PostgreSQL + pgvector.

> **Status:** V1 complete · 251 tests passing · Node ≥ 20 · Postgres 15+ with pgvector

## 60-second quick-start

<!-- Regenerate with docs/media/record-demo.sh · instructions in docs/media/README.md -->
<!-- demo.gif is intentionally NOT committed by default; uncomment the line
     below once docs/media/demo.gif has been recorded. -->
<!-- ![60-second setup demo](docs/media/demo.gif) -->

**What it is.** A durable, trust-scored memory store your coding agent can
write to and query over MCP or HTTP-style CLI — so the LLM stops forgetting
your architecture decisions between sessions.

**Run it** (no Node install on the host required):

```bash
curl -o docker-compose.yml \
  https://raw.githubusercontent.com/event4u-app/agent-memory/main/docker-compose.yml
docker compose up -d agent-memory
```

**Check it.** One command verifies the DB, pgvector, and migrations:

```bash
docker compose exec agent-memory memory doctor
# → 4 ok · 1 warn · 0 fail · 0 skipped   (exit 0)
```

**Query it.** Every command emits JSON. Pipe it into `jq`, or into your
agent:

```bash
docker compose exec agent-memory memory retrieve "how are invoices calculated?"
```

**Integrate it.** `agent-memory` is **stack-agnostic** — it runs as a
Docker sidecar next to any application, as a Node library when you want
direct calls, or as a standalone CLI from any language that can spawn a
subprocess. Pick the guide that matches how you want to talk to it:

- **Any language / shell** → [`docs/consumer-setup-generic.md`](docs/consumer-setup-generic.md)
- **Docker sidecar (recommended — works with any stack)** → [`docs/consumer-setup-docker-sidecar.md`](docs/consumer-setup-docker-sidecar.md)
- **Node / TypeScript (programmatic API)** → [`docs/consumer-setup-node.md`](docs/consumer-setup-node.md)
- **Any MCP client** (Claude Desktop, Cursor, Cline, Augment…) → point it at
  `command: docker`, `args: ["compose", "exec", "-i", "agent-memory", "memory", "mcp"]`

## Why

LLMs forget. They hallucinate project facts. They restate preferences you
corrected last week. `agent-memory` gives your agent a durable,
**trust-scored** memory of your project — architecture decisions, bug
patterns, coding conventions — with automatic decay, evidence-gated
promotion, and invalidation when code changes.

## What you get

- **23 MCP tools** — any agent that speaks MCP (Claude Desktop, Cursor, Cline, Augment…) can retrieve, ingest, invalidate, and promote memory.
- **16 CLI commands** — pure JSON on stdout, safe for scripts and CI.
- **4-tier memory** — Working → Episodic → Semantic → Procedural, auto-consolidated at session end.
- **Evidence-gated promotion** — nothing enters `validated` without passing gate criteria (file/symbol exists, diff impact, tests linked).
- **Ebbinghaus decay** — memories fade unless used; ADRs never decay.
- **Privacy filter** — strips secrets, API keys, PII before anything hits the DB.

## Non-goals

To keep expectations honest:

- **Not a general-purpose vector database.** It is scoped specifically to
  agent-facing project knowledge with trust scoring, decay, and
  invalidation. If you need raw similarity search over arbitrary data,
  use a dedicated vector DB.
- **Not a pretrained model or dataset.** Memories are authored by your
  agents and humans — nothing ships preloaded.
- **Not a SaaS.** The whole thing runs in your infrastructure (Docker
  sidecar, or embedded as a Node library). No hosted tier.
- **Not a replacement for project documentation.** README, ADRs, and
  architecture docs still belong in your repo. Memory complements them,
  it does not replace them.

## Integrate with your project

`agent-memory` does not care what language your application is written
in. Pick the transport that fits how your code already talks to external
tools, then follow the matching guide.

| Transport | Guide | Works for | Runnable example |
|---|---|---|---|
| **Docker sidecar + CLI** | [`docs/consumer-setup-docker-sidecar.md`](docs/consumer-setup-docker-sidecar.md) | any language that can shell out | [`examples/laravel-sidecar/`](examples/laravel-sidecar/) |
| **Node programmatic API** | [`docs/consumer-setup-node.md`](docs/consumer-setup-node.md) | Node / TypeScript apps | [`examples/node-programmatic/`](examples/node-programmatic/) |
| **MCP stdio** | [`docs/consumer-setup-generic.md`](docs/consumer-setup-generic.md) | any MCP-aware agent client | — |

> Need a quick language-neutral overview first? Start at
> [`docs/consumer-setup-generic.md`](docs/consumer-setup-generic.md).
>
> Both runnable examples boot with a single `docker compose up -d` and
> end with a working `memory health → status: ok`.

## Installation

### As a dev dependency (recommended)

`agent-memory` is primarily a **development-time** tool — it stores what an
AI coding agent learns about *your* repository, and its surface area (CLI,
MCP server, Postgres sidecar) is scoped to engineers and their agents.
Install it as a dev dependency so it stays out of production bundles:

```bash
npm install --save-dev @event4u/agent-memory
```

You must also provide Postgres with pgvector. Easiest path — copy the bundled
docker-compose:

```bash
curl -o docker-compose.yml \
  https://raw.githubusercontent.com/event4u-app/agent-memory/main/examples/consumer-docker-compose.yml
docker compose up -d postgres
```

See [`examples/`](examples/) for ready-to-copy `docker-compose.yml` and
GitHub Actions snippets.

### Using it in production

Production use is supported but not the default target. If you ship
agent-memory as part of a running service (e.g. a backend that queries its
own memory at runtime), install it as a regular dependency instead:

```bash
npm install @event4u/agent-memory
```

Everything documented in this README applies the same way — only the
dependency scope changes.

### From source (development)

```bash
git clone https://github.com/event4u-app/agent-memory.git
cd agent-memory
npm install
docker compose up -d postgres
npm run db:migrate
npm test
```

## Quick start

```bash
# 1. Start Postgres (local dev)
docker compose up -d postgres

# 2. Run migrations
npm run db:migrate

# 3. Smoke test — returns JSON { status: "ok", features: [...] }
npx tsx src/cli/index.ts health

# 4. Ingest a memory
npx tsx src/cli/index.ts ingest \
  --type architecture_decision \
  --title "Use event sourcing for orders" \
  --summary "All order state changes go through domain events." \
  --repository my-app

# 5. Retrieve
npx tsx src/cli/index.ts retrieve "how do orders work?"
```

After `npm run build` + `npm install -g .` the `memory` binary is on your PATH.

## Environment

The five variables most consumers touch in week one. Everything else has
sane defaults — see [`docs/configuration.md`](docs/configuration.md) for
the full matrix.

| Variable | Default | Purpose |
|---|---|---|
| `DATABASE_URL` | `postgresql://memory:memory_dev@localhost:5433/agent_memory` | Postgres connection string. |
| `REPO_ROOT` | `process.cwd()` | Repo root the file/symbol validators resolve against. Inside the sidecar container this must match the volume mount (typically `/workspace`). |
| `EMBEDDING_PROVIDER` | `bm25-only` | `openai`, `gemini`, `voyage`, `local`, or `bm25-only` — see [Embeddings](#embeddings) below. |
| `MEMORY_TRUST_THRESHOLD_DEFAULT` | `0.6` | Minimum `trust_score` surfaced by retrieval. Lower to see low-trust entries during debugging. |
| `MEMORY_TOKEN_BUDGET` | `2000` | Default progressive-disclosure budget per retrieval call. |
| `MEMORY_AUTO_MIGRATE` | `true` (Docker image) | Container entrypoint runs `memory migrate` on startup. Set to `false` for ephemeral CLI containers or externally managed schemas. Host installs run `memory migrate` manually. |

A ready-to-copy template lives in [`.env.example`](.env.example).

## Embeddings

Retrieval ranks results by fusing lexical (BM25) and semantic (vector)
scores via RRF. The semantic half plugs in via `EMBEDDING_PROVIDER`:

| Provider | Status | Leaves your network? | When to pick it |
|---|---|---|---|
| `bm25-only` (default) | implemented | no | Zero-config onboarding, air-gapped installs, or when lexical recall is enough. |
| `openai` | implemented | **yes** — ingested text is sent to OpenAI | Best general-purpose quality; requires `OPENAI_API_KEY`. |
| `gemini` | scaffolded, falls back to `bm25-only` | **yes** (when implemented) | Tracked for a future release. Set `GEMINI_API_KEY`; runtime currently logs a warning and uses `bm25-only`. |
| `voyage` | scaffolded, falls back to `bm25-only` | **yes** (when implemented) | Same as `gemini`. Set `VOYAGE_API_KEY`. |
| `local` | reserved for on-device model, not yet implemented | no | Placeholder today; currently resolves to `bm25-only`. |

See the [provider chain source](src/embedding/factory.ts) for the exact
fallback rules. The privacy filter
([`src/ingestion/privacy-filter.ts`](src/ingestion/privacy-filter.ts))
strips secrets, API keys, and detected PII **before** text is sent to
any provider — but operators picking `openai` (or a future network-bound
provider) should treat memory content as "leaves the network". Full
env matrix in [`docs/configuration.md`](docs/configuration.md).

## Connect to your AI agent

Every MCP-aware agent works. Two options, pick by what you already have:

### Option A — Docker sidecar (recommended, no Node install)

Works for any project regardless of language. Assumes you ran
`docker compose up -d agent-memory` from the
[60-second quick-start](#60-second-quick-start).

`~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "agent-memory": {
      "command": "docker",
      "args": ["compose", "-f", "/abs/path/to/your/project/docker-compose.yml",
               "exec", "-i", "agent-memory", "memory", "mcp"]
    }
  }
}
```

> **`REPO_ROOT` with the sidecar.** `docker-compose.yml` already sets
> `REPO_ROOT=/workspace` inside the container (matching the `.:/workspace`
> bind mount) — do **not** pass a host path here. If you want to override
> the host mount source, export `REPO_ROOT=/host/path/to/repo` on the
> host *before* `docker compose up -d`; compose substitutes it into the
> volume definition without ever reaching the container environment.

### Option B — Installed npm binary

After `npm install -g @event4u/agent-memory` (or `npm install --save-dev`
in a Node-based project), run the MCP server directly:

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

### Cursor / Cline / Augment

Each agent has its own MCP config file, but the shape is identical to the
Claude examples above. Check your agent's docs for the file path; keep
`command`, `args`, and `env` as shown.

## How it works

### Trust lifecycle

```mermaid
flowchart LR
    A[tool / agent] -- propose --> Q[quarantine]
    Q -- gate criteria --> V[validated]
    V -- decay / TTL --> S[stale]
    V -- signature drift --> I[invalidated]
    V -- confirmed wrong --> P[poisoned]
    S -.->|refresh on hit| V
    S --> I
    I --> AR[archived]
    P -- cascade --> AR
    Q -- reject --> R[rejected] --> AR
```

Every entry enters `quarantine`. Gate criteria (≥1 evidence ref, all
validators green) promote it to `validated`. From there it decays on
TTL, can be invalidated on code drift, or poisoned if confirmed wrong
— with a cascade through entries derived from it.

### 4-tier memory

```mermaid
flowchart TB
    subgraph Working[Working · session]
        O[observations]
    end
    subgraph Episodic[Episodic · ~30d]
        E[session summaries]
    end
    subgraph Semantic[Semantic · 90d–∞]
        M[validated entries]
    end
    subgraph Procedural[Procedural · ∞]
        R[repeated workflows]
    end
    O -- session end --> E
    E -- consolidation --> M
    M -- recurrence --> R
```

Consolidation from Working to Episodic happens at session end; promotion
to Semantic is evidence-gated. Procedural entries are never decayed.

### ASCII fallback (environments without Mermaid)

```
propose → quarantine ──gate criteria──▶ validated ──decay/TTL──▶ stale
                                            │                      │
                                         evidence               cascade
                                            ▼                      ▼
                                      invalidated ─────────▶ archived
```

- **Trust-scored, not boolean** — every entry has a `trust_score` (0–1). Retrieval filters by threshold (default `0.6`).
- **Progressive disclosure** — L1 (index) / L2 (summary) / L3 (full) fits retrieval to your token budget.
- **Auto-invalidation** — `git diff` between two refs marks linked memories stale; signature drift triggers hard invalidation.
- **Rollback** — when a memory is confirmed wrong (`poison`), the cascade marks every derived task for review.

Full details: [`docs/data-model.md`](docs/data-model.md). Unfamiliar
term? See the [glossary](docs/glossary.md).

## Memory types

Nine canonical types cover most project knowledge:

| Type | Example |
|---|---|
| `architecture_decision` | "Use event sourcing for orders" |
| `domain_rule` | "An invoice cannot be modified after issuance" |
| `coding_convention` | "All services live in `src/services/*`, one per file" |
| `bug_pattern` | "N+1 query when iterating `order.items` without `with()`" |
| `refactoring_note` | "Migration from v1 API to v2 in progress — avoid v1 in new code" |
| `integration_constraint` | "Stripe webhook timeout is 10s, not 30s" |
| `deployment_warning` | "Run migration X before deploying service Y" |
| `test_strategy` | "Auth module uses contract tests, not unit tests" |
| `glossary_entry` | "'Dispatch' = external partner handoff, not internal queue" |

## Tools & commands

### MCP tools (23)

| Category | Tools |
|---|---|
| **Retrieval** | `memory_retrieve`, `memory_retrieve_details` |
| **Ingestion** | `memory_ingest`, `memory_propose`, `memory_promote` |
| **Trust** | `memory_validate`, `memory_verify`, `memory_invalidate`, `memory_poison`, `memory_deprecate` |
| **Session lifecycle** | `memory_session_start`, `memory_observe`, `memory_observe_failure`, `memory_session_end`, `memory_stop`, `memory_run_invalidation` |
| **Quality** | `memory_health`, `memory_diagnose`, `memory_audit`, `memory_review`, `memory_resolve_contradiction`, `memory_merge_duplicates`, `memory_prune` |

### CLI commands (16)

`retrieve` · `ingest` · `propose` · `promote` · `validate` · `invalidate` ·
`poison` · `rollback` · `verify` · `health` · `status` · `diagnose` ·
`migrate` · `doctor` · `serve` · `mcp`

Full reference: [`docs/cli-reference.md`](docs/cli-reference.md).

## Typical workflow

```bash
# Agent observes a bug fix — create a proposal with evidence
memory propose --type bug_pattern \
  --title "N+1 on invoice list" \
  --summary "Iterating order.items without with('items') triggers N+1." \
  --repository my-app \
  --source "PR#234" --confidence 0.7 \
  --scenario "invoice-export"

# After 3+ future decisions reference it and tests pass → promote
memory promote <proposal-id>

# Later: code change may invalidate it (diff target is always HEAD)
memory invalidate --from-git-diff --from-ref main

# A week later: entry turns out to be wrong — poison + rollback cascade
memory poison <uuid> "reason the entry is wrong"
memory rollback <uuid>
```

## Configuration

All settings have sensible defaults. Essentials:

| Variable | Default | Notes |
|---|---|---|
| `DATABASE_URL` | `postgresql://memory:memory_dev@localhost:5433/agent_memory` | Postgres |
| `REPO_ROOT` | `cwd` | for file / symbol validators |
| `EMBEDDING_PROVIDER` | `bm25-only` | fallback chain to BM25 if no API key |
| `MEMORY_TRUST_THRESHOLD_DEFAULT` | `0.6` | minimum score to be served |

Full reference (all env vars, decay overrides, CI examples):
[`docs/configuration.md`](docs/configuration.md).

## Project structure

```
src/
├── config.ts            # env → config
├── types.ts             # types, enums, trust lifecycle
├── db/                  # Postgres connection, migrations, repositories
├── retrieval/           # BM25 + vector + RRF + progressive disclosure
├── trust/               # scoring, transitions, validators, promotion, poison
├── ingestion/           # privacy filter, candidate, pipeline, scanners
├── consolidation/       # working → episodic → semantic promotion
├── invalidation/        # git diff, drift, TTL, rollback
├── quality/             # metrics, dedup, contradictions, archival
├── embedding/           # provider abstraction + fallback chain
├── infra/               # circuit breaker, retry
├── mcp/                 # MCP server (stdio), 23 tools
└── cli/                 # commander-based CLI

docs/
├── data-model.md        # Postgres schema, trust lifecycle, tiers, decay
├── glossary.md          # every term with source-of-truth pointer
├── cli-reference.md     # all CLI commands with examples
└── configuration.md     # every env var

examples/
├── consumer-docker-compose.yml
└── consumer-ci.yml
```

## Testing

```bash
npm test                 # 251 tests, vitest
npm run test:watch       # watch mode
npm run typecheck        # tsc --noEmit (strict)
npm run lint             # biome check
```

## Compatibility

Runtime dependencies only:

| `agent-memory` | Node | Postgres | Docker |
|---|---|---|---|
| 1.1.x (unreleased) | ≥ 20 | 15+ with pgvector | 24+ with Compose v2 |

Every `retrieve()` and `health()` response carries `contract_version: 1`.
Callers pinned to v1 MAY continue on a v2 response if they ignore unknown
fields; breaking renames bump the major. See the
[retrieval contract spec](agents/roadmaps/archive/from-agent-config/road-to-retrieval-contract.md).

For the full cross-axis matrix (runtime, contract, companion-package
pairings, breaking changes per release) see
[`docs/compatibility-matrix.md`](docs/compatibility-matrix.md).

### Optional companion — `@event4u/agent-config`

`agent-memory` stands on its own. It can be paired with
[`@event4u/agent-config`](https://github.com/event4u-app/agent-config) —
a separate package that ships agent behaviour (skills, rules, commands)
— and both were designed to combine, but neither depends on the other.
Use `agent-memory` with any agent that speaks MCP or any codebase that
can shell out to the CLI.

See [`docs/integration-agent-config.md`](docs/integration-agent-config.md)
for how the two packages combine, or
[`examples/with-agent-config/`](examples/with-agent-config/) for a
smoke-tested reference setup.

## Changelog

Release history, rename mappings, and upgrade notes live in
[`CHANGELOG.md`](CHANGELOG.md) (Keep-a-Changelog format). Start there
when upgrading across minor versions.

## Contributing

See [`CONTRIBUTING.md`](CONTRIBUTING.md) for dev setup, coding
conventions, commit format (Conventional Commits), and the full
verification pipeline that CI runs.

## Security

Report vulnerabilities via GitHub's [private advisory form](https://github.com/event4u-app/agent-memory/security/advisories/new),
not public issues. Supported versions and disclosure policy are in
[`SECURITY.md`](SECURITY.md).

## License

MIT
