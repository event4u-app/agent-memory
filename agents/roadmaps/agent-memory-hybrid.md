# Roadmap: Agent Memory Hybrid

> Build a persistent, trust-scored project memory system that any AI coding agent can use — combining fresh code context with long-lived project knowledge and automatic invalidation.

## Prerequisites

- [x] Read this roadmap fully before starting
- [x] Decide on target repository for the memory service (separate repo) → this repo: `event4u-app/agent-memory`
- [x] Decide on programming language (TypeScript recommended) → TypeScript (strict, ESM, Node ≥ 20)

## Context

AI coding agents (Augment, Claude Code, Cursor, Cline, Gemini, Copilot, etc.) excel at reading current code but forget everything between sessions. This system fills that gap:

- **Fresh code context** — provided by whichever agent/IDE is active
- **Persistent project memory** — stored externally, queryable by any agent
- **Controlled invalidation** — git diffs, file changes, symbol tracking prevent stale knowledge

The memory system is **not** a replacement for code understanding. It's a **verifiable knowledge cache** that reduces re-discovery across sessions.

- **Feature:** `agents/features/multi-agent-compatibility.md`
- **Jira:** none

### Inspiration & Prior Art

This roadmap builds on analysis of two existing open-source agent memory systems:

| Project | Stars | License | Key Contribution to Our Design |
|---|---|---|---|
| [agentmemory](https://github.com/rohitg00/agentmemory) | 1.4k | Apache-2.0 | 4-tier consolidation, Ebbinghaus decay, RRF fusion, token budgets, privacy filters, self-healing |
| [claude-mem](https://github.com/thedotmack/claude-mem) | 54k | AGPL-3.0 | Progressive disclosure (3-layer retrieval), lifecycle hooks, observation-first storage |

**What we adopt:** consolidation pipeline, decay model, retrieval fusion, progressive disclosure, token budgets, privacy filters, embedding fallback, self-healing.

**What neither has (our unique safety model):** quarantine status, contradiction detection, impact levels, post-task extraction guard, poison + cascade review, semantic drift detection, hard trust threshold.

---

## Core Principles

1. **Code is the primary source of truth.** Memory is supplementary, never authoritative.
2. **Every memory entry has provenance, scope, and trust status.**
3. **Invalidation is mandatory, not optional.** Stale knowledge is worse than no knowledge.
4. **Knowledge is stored atomically.** One fact per entry, not monolithic summaries.
5. **Only reusable knowledge is persisted.** Session notes are ephemeral.
6. **Agent-agnostic by design.** Any model, any agent, any IDE can consume and contribute.
7. **Tool-based interface.** CLI commands and/or MCP server — no vendor lock-in.

---

## Safety Rules (Iron Laws)

These rules are non-negotiable. They exist to prevent stale or wrong memory from causing real coding errors.

### 1. Mandatory Expiry (TTL)

Every memory entry has a **maximum age without revalidation**:

| Knowledge Class | Max age before forced staleness |
|---|---|
| Evergreen | 90 days |
| Semi-Stable | 30 days |
| Volatile | 7 days |

After this period, the entry is **automatically** set to `stale` — even if no code change triggered invalidation. Stale entries require revalidation before being served to agents.

### 2. Hard Trust Threshold

Entries below a minimum trust score are **never returned** to agents:

| Retrieval mode | Minimum trust score |
|---|---|
| Default (agent query) | 0.6 |
| Explicit low-trust search | 0.3 (with mandatory `⚠️ LOW TRUST` marker) |
| Below 0.3 | Never returned, only visible in admin/review |

### 3. Quarantine for New Entries

New entries created by agents start in `quarantine` status — NOT `validated`:

```
agent creates entry → quarantine → validation check → validated OR rejected
```

Quarantined entries are **never served** to other agents until validated. Validation requires:
- At least one evidence link (file, commit, test) verified against current code
- No contradiction with existing validated entries

### 4. Impact-Level Determines Trust Requirements

| Impact Level | Example Types | Min Evidence | Review Required |
|---|---|---|---|
| **Critical** | `architecture_decision`, `domain_rule` | 2+ evidence links | Human review recommended |
| **High** | `integration_constraint`, `deployment_warning` | 1+ evidence link | Automated validation |
| **Normal** | `bug_pattern`, `refactoring_note`, `test_strategy` | 1 evidence link | Automated validation |
| **Low** | `coding_convention`, `glossary_entry` | Optional | None |

Critical entries with only 1 evidence link get a **trust score cap of 0.7** — they cannot reach "fully trusted" without strong evidence.

### 5. Contradiction Detection

On every ingestion and retrieval:
- Check new entries against existing entries with overlapping scope (same files, symbols, modules)
- If contradiction detected → **both entries flagged** for review
- Neither is served to agents until conflict is resolved

### 6. Post-Task Extraction Guard

Knowledge extraction after task completion is only allowed when:
- All tests pass (if tests exist for affected area)
- No quality tool errors introduced
- Diff is reviewed (by agent or human)

If tests fail or quality degrades → extraction is **blocked**, not just warned.

### 7. Audit Trail with Traceability

Every memory entry that influences agent decisions must be traceable:
- Entry ID is included in agent output / commit metadata
- If wrong code is produced, the contributing memory entries can be identified
- Rollback: mark entry as `poisoned` → triggers re-review of all dependent decisions

### 8. Semantic Drift Detection

Beyond file-level invalidation:
- Track **function signatures** and **return types** of watched symbols
- If a function's behavior changes (different return type, renamed params, different side effects) but the file name stays the same → trigger invalidation
- V1 minimum: flag entries when watched files have large diffs (>50% of lines changed)

---

## Architecture Overview

```
┌─────────────────────────┐
│  Any AI Coding Agent     │
│  (Augment, Claude Code,  │
│   Cursor, Cline, etc.)   │
└────────────┬────────────┘
             │
             ▼
┌─────────────────────────┐
│  Memory Orchestrator     │
│  CLI / MCP Server / API  │
│  ingest · retrieve ·     │
│  validate · invalidate   │
└──────┬──────────┬───────┘
       │          │
       ▼          ▼
┌──────────┐ ┌──────────────┐
│  Vector  │ │  Relational  │
│  DB      │ │  (Postgres)  │
└──────────┘ └──────────────┘
       │          │
       ▼          ▼
┌─────────────────────────┐
│  Extractors / Indexers   │
│  Git · AST · Docs · PRs │
└─────────────────────────┘
```

### Agent Integration Points

| Integration | How |
|---|---|
| **MCP Server** | Any MCP-capable agent calls `memory:retrieve`, `memory:ingest`, etc. as tools |
| **CLI** | `memory retrieve "how are invoices calculated?"` — works from any terminal |
| **API** | REST/GraphQL endpoint for IDE extensions or custom tooling |
| **Agent Commands** | `.augment/commands/` or equivalent for each agent framework |

---

## Data Model

Every memory entry contains:

```json
{
  "id": "mem_...",
  "type": "architecture_decision",
  "title": "Order totals are recalculated only via DomainService",
  "summary": "Totals must not be computed in controllers or UI adapters.",
  "details": "...",
  "scope": {
    "repository": "app-core",
    "bounded_context": "billing",
    "files": ["src/Billing/..."],
    "symbols": ["OrderTotalService::recalculate"]
  },
  "evidence": [
    {"kind": "file", "ref": "src/Billing/OrderTotalService.ts"},
    {"kind": "commit", "ref": "abc123"},
    {"kind": "adr", "ref": "docs/adr/0007-order-total-policy.md"}
  ],
  "embedding_text": "...",
  "impact_level": "critical",
  "knowledge_class": "semi_stable",
  "trust": {
    "status": "validated",
    "score": 0.91,
    "validated_at": "2026-04-13T10:00:00Z",
    "expires_at": "2026-05-13T10:00:00Z",
    "min_evidence_count": 2
  },
  "invalidation": {
    "strategy": "file_symbol_dependency_based",
    "watched_files": ["src/Billing/OrderTotalService.ts"],
    "watched_symbols": ["OrderTotalService::recalculate"],
    "watched_signatures": ["recalculate(order: Order): Money"]
  },
  "created_by": "agent",
  "created_in_task": "task_abc123",
  "updated_at": "2026-04-13T10:00:00Z"
}
```

### Memory Types

| Type | Example |
|---|---|
| `architecture_decision` | "All prices normalized via MoneyValueObject" |
| `domain_rule` | "Retries for Provider X only via IntegrationAdapter" |
| `integration_constraint` | "Feature flag Y must be active during tenant migration" |
| `bug_pattern` | "N+1 query in OrderList when eager loading disabled" |
| `refactoring_note` | "Legacy PaymentService being replaced by PaymentGateway" |
| `test_strategy` | "Billing module uses integration tests, no unit tests" |
| `deployment_warning` | "Queue restart required after config change" |
| `coding_convention` | "All DTOs are readonly final classes" |
| `glossary_entry` | "FQDN = Fully Qualified Domain Name, used as tenant identifier" |

### NOT stored (ephemeral)

- "Opened file X today"
- "I suspect there might be a bug here"
- "Task half-finished"
- Current session plans, temporary hypotheses


---

## Memory Knowledge Classes

### 1. Evergreen Memory

Long-lived, rarely changes. Examples: bounded contexts, architecture principles, naming conventions, security policies.

### 2. Semi-Stable Memory

Relevant but mutable. Examples: integration paths, module dependencies, caching rules, test strategies per module.

### 3. Volatile Memory

Quickly outdated. Examples: current workarounds, hotfix notes, temporary branch assumptions, migration transition rules.

### 4. Session Memory (NOT persisted)

Ephemeral. Current task plan, session to-dos, temporary hypotheses. Discarded after session.

---

## Memory Consolidation Pipeline

Inspired by [agentmemory](https://github.com/rohitg00/agentmemory)'s 4-tier model (analogous to human sleep consolidation):

```
Raw Observation → Working Memory → Episodic Memory → Semantic Memory → Procedural Memory
```

| Tier | What | Analogy | Lifecycle |
|---|---|---|---|
| **Working** | Raw tool observations, file reads, errors | Short-term memory | Auto-captured during session, deduped (SHA-256, 5-min window) |
| **Episodic** | Compressed session summaries | "What happened" | Generated at session end, links to observations |
| **Semantic** | Extracted facts, patterns, decisions | "What I know" | Extracted from episodic, enters quarantine |
| **Procedural** | Proven workflows, decision patterns | "How to do it" | Promoted from semantic after repeated validation |

### Consolidation Rules

- Working → Episodic: **automatic** at session end (compress observations into summary)
- Episodic → Semantic: **agent-triggered** or **scheduled** (extract stable knowledge from summaries)
- Semantic → Procedural: **only after 3+ successful validations** (proven pattern, not just observed once)
- Each tier has its own TTL multiplier: Working (1d) → Episodic (7d) → Semantic (30d) → Procedural (90d)

### Ebbinghaus Decay Model

Instead of flat TTL expiry, memory strength follows an access-frequency curve:

- **Every retrieval strengthens** the memory (increases trust score, extends effective TTL)
- **Lack of access weakens** the memory (trust score slowly decays toward stale threshold)
- **Decay rate varies by knowledge class:** Evergreen decays slowest, Volatile decays fastest
- **Hard floor:** Even frequently accessed memories must be revalidated when evidence changes

This means: a frequently-used architecture decision stays strong indefinitely (until code contradicts it), while a rarely-accessed bugfix note fades naturally.

---

## Trust & Validation

### Trust Statuses

```
quarantine → validated       (evidence verified, no contradictions)
quarantine → rejected        (evidence invalid or contradicts existing entries)
validated → stale            (TTL expired or evidence weakened)
stale → validated            (revalidated successfully)
validated → invalidated      (hard invalidation — symbol deleted, evidence gone)
stale → invalidated          (hard invalidation while already stale)
invalidated → archived       (no longer relevant, kept for audit)
any → poisoned               (confirmed wrong — triggers cascade review)
poisoned → archived          (after dependent decisions reviewed)
```

| Status | Served to agents? | Meaning |
|---|---|---|
| `quarantine` | ❌ Never | New, unverified — awaiting validation |
| `validated` | ✅ Yes | Evidence verified, trust score above threshold |
| `stale` | ⚠️ With warning | TTL expired or evidence weakened — needs revalidation |
| `invalidated` | ❌ Never | Hard-invalidated — evidence gone or contradicted |
| `rejected` | ❌ Never | Failed quarantine validation |
| `poisoned` | ❌ Never | Confirmed wrong — triggers review of dependent entries |
| `archived` | ❌ Never | Historical record only |

### Trust Signals

- Direct code evidence exists
- Referenced symbol still exists
- Referenced files unchanged
- Tests confirm behavior
- Documentation matches code
- Recent commits don't contradict

### Invalidation Triggers

- File changed
- Symbol changed / deleted / renamed
- Module structure changed
- Relevant tests changed
- ADR / documentation changed
- Dependent integration changed
- Large refactor / migration detected
- Branch switch
- Merge into main

### Invalidation Modes

| Mode | When | Effect |
|---|---|---|
| **TTL expiry** | Max age reached without revalidation | Status → `stale`, blocked until revalidated |
| **Soft invalidate** | Evidence weakened (file changed, small diff) | Status → `stale`, served with warning |
| **Hard invalidate** | Core symbol deleted, evidence gone | Status → `invalidated`, never served |
| **Contradiction** | New entry contradicts existing one | Both entries flagged, neither served until resolved |
| **Poison** | Entry confirmed to have caused wrong code | Status → `poisoned`, cascade review of dependents |
| **Semantic drift** | Watched symbol signature/behavior changed significantly | Status → `stale`, higher revalidation priority |

---

## Retrieval Strategy

### Triple-Stream Retrieval (inspired by [agentmemory](https://github.com/rohitg00/agentmemory))

Three parallel search streams, fused with Reciprocal Rank Fusion (RRF, k=60):

| Stream | What | When |
|---|---|---|
| **BM25 (Lexical)** | Stemmed keyword matching with synonym expansion | Always on |
| **Vector** | Cosine similarity over dense embeddings | When embedding provider configured |
| **Knowledge Graph** | Entity matching + BFS traversal | When entities detected in query (V2) |

Pipeline:

1. Run all streams in parallel
2. Apply **metadata filters** (repository, module, type, trust status)
3. **Freshness check** — validate against current git state, auto-stale expired entries
4. **RRF Fusion** — combine rankings from all streams
5. **Session diversification** — max 3 results per source session (prevents one session dominating)
6. **Trust threshold** — filter out entries below 0.6 trust score
7. **Token budget** — cap total response at configurable token limit (default: 2000)

### Progressive Disclosure (inspired by [claude-mem](https://github.com/thedotmack/claude-mem))

3-layer retrieval for ~10x token savings:

| Layer | What | Tokens/result | When |
|---|---|---|---|
| **1. Index** | Compact list: ID, title, trust score, type | ~50-100 | Always (default) |
| **2. Timeline** | Chronological context around selected entries | ~200-300 | On demand |
| **3. Full Details** | Complete entry with evidence, scope, metadata | ~500-1000 | Only for filtered IDs |

Agents query Layer 1 first, review the index, then fetch Layer 3 only for relevant entries. This prevents loading 20 full entries when only 3 are needed.

### Ranking Signals

- Semantic similarity to query
- Same files / modules / symbols as current context
- Same domain / bounded context
- Relevance to current diff
- Trust status and last validation time
- Access frequency (Ebbinghaus strength)
- Consolidation tier (Procedural > Semantic > Episodic)

### Token Budget

Every retrieval respects a configurable token budget (default: 2000 tokens):

- Layer 1 index entries are always within budget
- Layer 3 full entries counted against budget — system stops when budget exceeded
- Agent can override with explicit `--budget <tokens>` flag
- Budget prevents memory context from overwhelming the agent's context window

### Embedding Provider Fallback Chain (inspired by [agentmemory](https://github.com/rohitg00/agentmemory))

Auto-detect available providers, prefer free/local:

| Priority | Provider | Cost | Notes |
|---|---|---|---|
| 1 | **Local** (`all-MiniLM-L6-v2`) | Free | Offline, no API key needed |
| 2 | Gemini (`text-embedding-004`) | Free tier | 1500 RPM |
| 3 | OpenAI (`text-embedding-3-small`) | $0.02/1M | Highest quality |
| 4 | Voyage AI (`voyage-code-3`) | Paid | Optimized for code |
| Fallback | BM25 only | Free | No embeddings, lexical only |

---

## Recommended Tech Stack

| Layer | Recommendation | Rationale |
|---|---|---|
| **Language** | TypeScript | Close to IDE tooling, MCP ecosystem, Node.js |
| **Database** | Postgres + pgvector | Vector search + relational in one DB |
| **Structured metadata** | Postgres (same DB) | Simplicity for V1 |
| **Parsing** | Tree-sitter or language-specific parsers | AST / symbol extraction |
| **Git analysis** | Git CLI | Commit, diff, and history analysis |
| **Jobs** | Simple queue or cron | Sync job runner for V1 |
| **Interface** | CLI + MCP Server | Agent-agnostic access |
| **Graph (V2)** | Neo4j or Postgres relations | Only when relationship queries needed |

---

## Pre-Storage Privacy Filter

Before ANY data enters storage (inspired by [agentmemory](https://github.com/rohitg00/agentmemory)):

1. **Strip secrets** — API keys, tokens, passwords, connection strings (regex + entropy detection)
2. **Strip PII** — emails, phone numbers, names (configurable per project)
3. **Honor `<private>` tags** — content wrapped in `<private>...</private>` is never stored
4. **Sanitize file paths** — normalize to relative paths, strip home directory
5. **Redact environment variables** — `.env` content never stored verbatim

This runs BEFORE embedding creation, BEFORE storage, BEFORE any processing. Non-negotiable.

---

## Agent Workflow Integration

### Lifecycle Hooks (inspired by [claude-mem](https://github.com/thedotmack/claude-mem))

| Hook | Trigger | Memory Action |
|---|---|---|
| **SessionStart** | Agent session begins | Retrieve relevant context (Layer 1 index), inject within token budget |
| **PreToolUse** | Before file read/edit | Enrich with file-specific memories |
| **PostToolUse** | After tool execution | Capture raw observation (Working Memory tier) |
| **PostToolUseFailure** | Tool error | Capture error context (may become bug_pattern) |
| **Stop** | Task complete | Trigger post-task extraction (with guard checks) |
| **SessionEnd** | Session closes | Consolidate Working → Episodic, run dedup |

### Pre-Task

1. Agent receives task
2. Agent (or tool) identifies affected modules/files
3. Memory system retrieves relevant entries (Layer 1 index, within token budget)
4. Top entries validated against current code/git
5. Only validated or explicitly-marked-stale entries passed to agent
6. Stale entries include `⚠️ STALE` marker — agent decides whether to use

### During Task

- Raw observations captured automatically via PostToolUse hook (Working Memory)
- SHA-256 dedup with 5-minute window prevents duplicate observations
- Agent uses its own code understanding (codebase search, context window, etc.)
- Memory serves as supplementary context, never overriding fresh code
- Session notes kept in Working Memory tier (ephemeral)
- Agent can explicitly `memory save` important decisions mid-task

### Post-Task

1. **Guard check:** tests must pass, no quality regressions (extraction blocked otherwise)
2. Consolidate Working → Episodic (compress observations into session summary)
3. Extract Semantic entries from Episodic (stable knowledge enters quarantine)
4. Analyze diffs — update or invalidate affected existing entries
5. Run contradiction detection against new entries
6. Privacy filter on all new entries before final storage
7. Discard Working Memory (raw observations) after consolidation

---

## V1 Scope — What's In, What's Out

### In V1

- Memory entries with evidence + trust status
- 4-tier consolidation pipeline (Working → Episodic → Semantic → Procedural)
- Ebbinghaus decay model (access-frequency based)
- Triple-stream retrieval (BM25 + Vector, RRF fusion)
- Progressive disclosure (3-layer: Index → Timeline → Full)
- Token budget for context injection
- Pre-storage privacy filter
- Embedding provider fallback chain (local-first, free default)
- File-level git-diff invalidation
- Lifecycle hooks (SessionStart, PostToolUse, Stop, SessionEnd)
- SHA-256 dedup with time window
- Manual + agent-triggered ingestion
- CLI commands + MCP server interface
- Trust scoring and status transitions
- Self-healing / circuit breaker
- Basic ingestion from code, docs, git history

### NOT in V1

- Full knowledge graph with traversal (Neo4j / graph queries)
- Automatic symbol-level dependency graphs
- Complex multi-agent orchestration (leases, signals)
- Fully autonomous decision systems
- IDE extensions / VS Code plugins
- PR / ticket integration
- Branch-specific temporary memory
- Team memory (namespaced shared/private)
- Real-time web viewer
- MEMORY.md bridge (bi-directional sync with file-based memory)
- Action system (frontier, next, work item tracking)
- Git-based memory snapshots (version, rollback, diff)
- Endless mode (biomimetic memory for extended sessions)

---

## Phase 0: Scope & Architecture Decisions

### Goal

Lock down all foundational decisions before writing code.

### Checklist

- [x] Define V1 goal in writing → ADR-0001
- [x] Decide: TypeScript → ADR-0001 Decision 1
- [x] Decide: Postgres + pgvector → ADR-0001 Decision 2
- [x] Define first 5 memory types → ADR-0001 Decision 3
- [x] Define trust statuses → ADR-0001 Decision 4
- [x] Define revalidation triggers → ADR-0001 Decision 5
- [x] Define TTL per knowledge class → ADR-0001 Decision 6
- [x] Define hard trust threshold → ADR-0001 Decision 7
- [x] Define impact levels and min evidence → ADR-0001 Decision 8
- [x] Define quarantine → validation flow → ADR-0001 Decision 9
- [x] Define contradiction detection strategy → ADR-0001 Decision 10
- [x] Define post-task extraction guard rules → ADR-0001 Decision 11
- [x] Decide: CLI-first → ADR-0001 Decision 12
- [x] Choose example repository (agent-config) → ADR-0001 Decision 13
- [x] Create architecture ADR → `agents/adrs/0001-agent-memory-architecture.md`

### Acceptance Criteria

- Anyone can explain in 5 minutes what Memory stores and what it doesn't
- V1 scope exists with clear boundaries
- Safety rules documented and non-negotiable

---

## Phase 1: Project Setup & Infrastructure

### Goal

A runnable base project with clean local development setup.

### Checklist

- [x] Initialize repository → [`event4u-app/agent-memory`](https://github.com/event4u-app/agent-memory)
- [x] Add Docker / dev container setup → `docker-compose.yml` (Postgres dev + test)
- [x] Configure Postgres with pgvector → `pgvector/pgvector:pg17` image
- [x] Set up DB migrations → `src/db/migrations/001_initial.ts` (7 tables)
- [x] Create `.env.example`
- [x] Integrate logging (structured, JSON) → pino logger
- [x] Define error handling and structured error codes → `InvalidTransitionError`
- [x] Implement circuit breaker for external dependencies (embedding APIs, etc.) → `src/infra/circuit-breaker.ts`
- [x] Implement health monitoring (`memory health` command) → CLI stub
- [x] Implement self-healing: auto-recovery from transient failures, provider fallback → `src/infra/retry.ts` (exponential backoff + jitter) + `src/embedding/fallback-chain.ts` (multi-provider fallback with circuit breaker per provider)
- [x] Provide healthcheck endpoint → `healthCheck()` in `db/connection.ts`
- [x] Create baseline README
- [x] Stub CLI commands → 8 commands: ingest, retrieve, validate, invalidate, poison, verify, health, diagnose
- [x] Configure embedding provider fallback chain → config with 5 provider options

### Acceptance Criteria

- Project starts locally and reproducibly
- DB migrations run cleanly
- Base commands exist (stubs)

---

## Phase 2: Data Model & Storage

### Goal

Store, load, and version memory entries in a structured way.

### Checklist

- [x] Create `memory_entries` table → `001_initial.ts`
- [x] Create `memory_observations` table → `001_initial.ts`
- [x] Create `memory_episodes` table → `001_initial.ts`
- [x] Create `memory_evidence` table → `001_initial.ts`
- [x] Create `memory_links` table → `001_initial.ts`
- [x] Create `memory_status_history` table → `001_initial.ts`
- [x] Create `memory_contradictions` table → `001_initial.ts`
- [x] Add vector column for embeddings → `embedding vector(384)`
- [x] Add `created_in_task` for traceability
- [x] Add `observation_hash` column → SHA-256 dedup in ObservationRepository
- [x] Implement status transition rules → `trust/transitions.ts`
- [x] Implement TTL expiry check (auto-stale on query if expired) → `applyExpiryFilter()` in retrieval engine + `ttl-expiry-job.ts`
- [x] Implement Ebbinghaus decay → `recordAccess()` in MemoryEntryRepository
- [x] Implement repository / DAO layer → 4 repositories
- [x] Write unit tests for CRUD operations → 26 tests
- [x] Write unit tests for status transition enforcement → 15 tests
- [x] Write unit tests for consolidation tier promotion rules → `tests/unit/tier-promotion.test.ts` (205 lines)

### Acceptance Criteria

- Entries can be stored with evidence, trust status, impact level, and knowledge class
- Status change history is traceable (who, when, why)
- Invalid status transitions are rejected
- TTL expiry is enforced on read

---

## Phase 3: Retrieval Engine

### Goal

Find relevant knowledge snippets for the current task.

### Checklist

- [x] Implement BM25 lexical search → `retrieval/bm25.ts`
- [x] Implement vector search (cosine similarity) → `retrieval/vector-search.ts`
- [x] Implement RRF fusion (k=60) → `retrieval/rrf-fusion.ts`
- [x] Implement session diversification → `retrieval/engine.ts`
- [x] Implement filters by repository / module / type / trust / status / tier → `RetrievalOptions.filters`
- [x] Implement ranking function (relevance + trust + freshness + access + tier) → `retrieval/engine.ts` trust-aware re-ranking
- [x] Implement Progressive Disclosure → `retrieval/progressive-disclosure.ts`
  - [x] Layer 1: Index response (~50-100 tokens/result) — ID, title, trust, type
  - [x] Layer 2: Timeline response (~200-300 tokens/result) — chronological context
  - [x] Layer 3: Full response (~500-1000 tokens/result) — complete entry with evidence
- [x] Implement token budget (default: 2000, configurable) → `config.tokenBudget`
- [x] Implement embedding provider auto-detection + fallback chain → `src/embedding/factory.ts` (detect from config + API key) + `src/embedding/fallback-chain.ts` (retry + circuit breaker per provider, bm25-only terminator)
- [x] Enforce hard trust threshold → `config.trust.thresholdDefault` (0.6)
- [x] Implement explicit low-trust mode (0.3 min) → `RetrievalOptions.lowTrustMode`
- [x] Filter out quarantine/invalidated/rejected/poisoned/archived → `retrieval/engine.ts`
- [x] Check TTL on every retrieval → auto-stale in `retrieve()`
- [x] Factor Ebbinghaus strength into ranking → access_count + last_accessed_at in re-ranking
- [x] Update access_count and last_accessed_at on every retrieval hit → `recordAccess()`
- [x] Include trust status + evidence count + tier in response format
- [x] Provide query API and CLI command → MCP `memory_retrieve` tool
- [x] Define agent-friendly response format → JSON with trust metadata
- [x] Write tests: ensure stale entries are not returned without warning
- [x] Write tests: ensure quarantined entries are never returned
- [x] Write tests: progressive disclosure returns correct detail levels
- [x] Write tests: token budget is respected
- [x] Write tests with realistic queries

**Retrieval Contract (from `agent-config` spec: `road-to-retrieval-contract.md`):**

- [x] Add `contract_version: 1` to every retrieve response envelope → `src/retrieval/contract.ts`
- [x] Implement partial-hit semantics: per-slice status (`ok` / `timeout` / `unknown_type` / `misconfigured`) → `SliceStatus`, `SliceSummary`
- [x] Return `status: ok | partial | error` on envelope level → `computeEnvelopeStatus()`
- [x] Enforce `timeout_ms` budget across concurrent slices (hard ceiling: budget + 100ms) → enforced via `Promise.race` in retrieve handler
- [x] Implement error codes: `ok`, `timeout`, `unknown_type`, `misconfigured`, `internal`
- [x] Implement health contract: `health(timeout_ms)` → `{ contract_version, status, backend_version, features[] }` → `memory_health` MCP + `memory health` CLI
- [x] Publish JSON schema for retrieval contract v1 → `tests/fixtures/retrieval/retrieval-v1.schema.json` + `health-v1.schema.json`
- [x] Create golden fixture test files for contract conformance → 5 fixtures + 20 conformance tests
- [x] Implement version negotiation: callers pinned to v1 ignore unknown fields from v2+ → envelope `additionalProperties: true`, consumer pattern documented in README

### Acceptance Criteria

- For real coding tasks, relevant memory entries are found
- RRF fusion produces better results than either stream alone
- Progressive disclosure reduces token usage by ~10x vs always returning full entries
- Token budget is enforced — response never exceeds configured limit
- Stale entries are only returned with explicit warning
- Quarantined / invalidated / poisoned entries are NEVER returned
- Trust score, status, and tier visible in every response
- Retrieval contract v1: every response carries `contract_version`, partial failures don't crash callers

---

## Phase 4: Trust & Validation System

### Goal

Memory must not be blindly trusted. Relevant entries must be validated before use.

### Checklist

- [x] Define trust model (scores, thresholds, caps per impact level) → `types.ts`, `scoring.ts`
- [x] Implement quarantine flow (new entries start in quarantine) → `memory-entry.repository.ts`
- [x] Implement quarantine → validated transition (evidence check + no contradictions) → `quarantine.service.ts`
- [x] Implement quarantine → rejected transition → `quarantine.service.ts`
- [x] Create validator interfaces → `trust/validators/types.ts`
- [x] Build file-exists validator → `trust/validators/file-exists.validator.ts`
- [x] Build symbol-exists validator (including signature comparison) → `trust/validators/symbol-exists.validator.ts`
- [x] Build diff-impact validator → `trust/validators/diff-impact.validator.ts`
- [x] Build test-linked validator (check if related tests still pass) → `trust/validators/test-linked.validator.ts`
- [x] Implement contradiction detection (overlapping scope, opposing claims) → `trust/contradiction.service.ts`
- [x] Implement contradiction resolution flow (flag both, block both) → `contradiction.service.ts` + `contradiction.repository.ts`
- [x] Implement impact-level trust score cap (critical with 1 evidence → max 0.7) → `types.ts` (Phase 2)
- [x] Implement trust score calculation (evidence count × type weight × freshness) → `scoring.ts` (Phase 2)
- [x] Implement TTL enforcement per knowledge class → `expiry.ts` (Phase 2)
- [x] Implement `poisoned` status + cascade review trigger → `trust/poison.service.ts`
- [x] Document all status transitions with validation rules → `types.ts` VALID_TRANSITIONS
- [x] Connect trust with retrieval ranking → `retrieval/engine.ts` (trust-aware re-ranking)
- [x] Write tests: quarantined entry never bypasses validation → `quarantine.test.ts`
- [x] Write tests: contradiction blocks both entries → `quarantine.test.ts`
- [x] Write tests: TTL expiry correctly triggers staleness → `expiry.test.ts` (Phase 2)

**Decay Calibration (from `agent-config` spec: `road-to-decay-calibration.md`):**

- [x] Implement per-type decay overrides (not just per-tier) → `src/trust/decay.ts` `DEFAULT_DECAY_CONFIG.types`:
  - Domain invariant: half-life 365d
  - Ownership: half-life 365d
  - Historical bug pattern: half-life 180d, floor 0.5
  - Incident learning: half-life 90d
  - ADR: no decay (only explicit deprecate)
  - Product rule: half-life 365d
- [x] Accept `half_life_days: null` → skip decay arithmetic for matching entries → `resolveDecayRule()`
- [x] Implement retrieval-hit refresh: successful retrieval counts as validation (max 1 refresh per entry per 7 days) → `shouldRefreshOnHit()` wired into `engine.ts` recordAccess
- [x] Working memory: 2h half-life, hard-drop at session end, not returned via `retrieve()` → `tier-promotion.ts` session-end, tier filter in retrieval
- [x] Accept decay config from consumer via config override surface → `MEMORY_DECAY_TYPE_OVERRIDES` env JSON + `mergeDecayConfig()`

**Promotion Flow (from `agent-config` spec: `road-to-promotion-flow.md`):**

- [x] Implement `propose()` API: accepts entry + type + source + confidence → proposal_id → `memory_propose` MCP tool
- [x] Implement `promote(proposal_id)` with gate criteria → `memory_promote` MCP tool + `PromotionService`:
  - Mandatory fields: id, status, confidence, source, owner, last_validated
  - At least one source reference (incident id, PR, ADR)
  - Impact-level evidence floor satisfied
  - Extraction guard clean at proposal time
  - Non-duplication check against existing semantic entries
- [x] Implement `deprecate(id, reason, superseded_by?)` API → `memory_deprecate` MCP tool
- [x] Implement `prune(policy)` API → counts of decayed/archived → `memory_prune` MCP tool

### Acceptance Criteria

- Every returned entry has a traceable trust status
- Outdated entries are visibly downgraded
- New entries must pass quarantine before being served
- Contradictions are detected and both entries blocked
- Poisoning an entry triggers review of all dependent entries
- Per-type decay rates applied correctly (ADRs never decay, bug patterns decay slower)
- Promotion gate rejects entries without sufficient evidence

---

## Phase 5: Ingestion Pipeline

### Goal

Generate memory candidates from code, docs, and git history.

### Sources

- Source code (AST, comments, structure)
- README / documentation
- ADRs (Architecture Decision Records)
- Tests
- Git commits (messages, diffs)
- PR descriptions

### Checklist

**Observation capture (Working Memory):**

- [x] Implement PostToolUse hook — capture raw observations automatically → `memory_observe` MCP tool (registered in `tool-definitions.ts`; handler in `tool-handlers.ts`)
- [x] Implement SHA-256 dedup with 5-minute time window → `observation.repository.ts` (Phase 2)
- [x] Run pre-storage privacy filter on every observation → `ingestion/privacy-filter.ts`
- [x] Store observations in `memory_observations` table with session ID + timestamp → `observation.repository.ts` (Phase 2)

**Consolidation (Working → Episodic → Semantic):**

- [x] Implement Working → Episodic consolidation → `consolidation/working-to-episodic.ts`
- [x] Implement Episodic → Semantic extraction → `consolidation/episodic-to-semantic.ts`
- [x] Implement Semantic → Procedural promotion → `consolidation/tier-promotion.ts` (Phase 2)
- [x] Implement session-end trigger for consolidation → `memory_session_end` MCP tool (runs `WorkingToEpisodicConsolidator.consolidate()` + revalidation job)

**Source scanners:**

- [x] Implement file scanner → `ingestion/scanners/file-scanner.ts`
- [x] Integrate symbol extraction (including function signatures) → `ingestion/scanners/symbol-extractor.ts`
- [x] Integrate documentation reader → `ingestion/scanners/doc-reader.ts`
- [x] Integrate git commit reader → `ingestion/scanners/git-reader.ts`
- [x] Define candidate model → `ingestion/candidate.ts`
- [x] Define heuristics for relevant knowledge extraction → auto-classification in `candidate.ts`

**Safety gates:**

- [x] Implement contradiction check on ingestion → `trust/contradiction.service.ts` + `ingestion/pipeline.ts`
- [x] Integrate embedding creation (using fallback provider chain) → `IngestionPipeline` takes optional `EmbeddingFallbackChain`; when present, each candidate's `embeddingText` is embedded before `entryRepo.create()`
- [x] Implement post-task extraction guard → `ingestion/extraction-guard.ts`
  - [x] Check test results before allowing extraction
  - [x] Check quality tool results (if available)
  - [x] Block extraction if tests fail or quality degrades
  - [x] All new Semantic entries enter quarantine (never directly validated) → `memory-entry.repository.ts`
- [x] Assign impact level automatically based on memory type → `candidate.ts` `classifyCandidate()`
- [x] Assign knowledge class automatically (evergreen/semi-stable/volatile) → `candidate.ts`
- [x] Assign consolidation tier based on source (observation=working, extraction=semantic) → `candidate.ts`
- [x] Calculate and set TTL based on knowledge class + Ebbinghaus base → `scoring.ts` (Phase 2)

### Acceptance Criteria

- Raw observations captured automatically during sessions
- SHA-256 dedup prevents duplicate observations within 5-minute window
- Privacy filter runs before any storage (secrets, PII, `<private>` tags stripped)
- Consolidation pipeline compresses observations → summaries → entries
- All new Semantic/Procedural entries start in quarantine status
- Post-task extraction is blocked when tests fail
- Contradictions detected during ingestion
- Noise is manageable

---

## Phase 6: Invalidation Engine

### Goal

Automatically react to code changes and update memory trust status.

### Checklist

- [x] Implement git diff reader → `invalidation/git-diff.ts`
- [x] Implement file-based watch rules → `invalidation/watchers.ts`
- [x] Implement symbol-based watch rules (including signature comparison) → `invalidation/watchers.ts`
- [x] Implement semantic drift detection → `invalidation/semantic-drift.ts`
  - [x] Track function signatures of watched symbols
  - [x] Flag entries when >50% of watched file lines changed
  - [ ] Detect renamed symbols (heuristic — deferred, rename detection in git-diff covers basics)
- [x] Add dependency-based invalidation → module-level matching in `watchers.ts`
- [x] Build TTL expiry job → `invalidation/ttl-expiry-job.ts`
- [x] Build soft-invalidate flow (→ `stale`) → `invalidation/invalidation-flows.ts`
- [x] Build hard-invalidate flow (→ `invalidated`) → `invalidation/invalidation-flows.ts`
- [x] Build poison flow (→ `poisoned`, cascade) → `trust/poison.service.ts` (Phase 4)
- [x] Implement rollback mechanism → `invalidation/rollback.ts`
  - [x] Track which entries influenced which tasks
  - [x] When entry is poisoned, list all tasks that used it
  - [x] Provide `memory rollback <entry-id>` CLI command → `src/cli/index.ts` `rollback` command (wraps `RollbackService.poisonAndReport` with report-focused output)
- [x] Introduce revalidation jobs → `invalidation/revalidation-job.ts`
- [x] Create audit log for all invalidation events → `memory_status_history` table (Phase 2)

### Acceptance Criteria

- When relevant files change, memory system reacts correctly
- TTL expiry runs on schedule and stales expired entries
- Semantic drift detected for significant symbol changes
- Poisoned entries trigger cascade review of dependents
- Full audit trail for every status change

---

## Phase 7: MCP Server & Agent Integration

### Goal

Make memory practically usable from any AI coding agent via MCP protocol.

### Checklist

**MCP tools:**

- [x] `memory_retrieve` — query with progressive disclosure (L1/L2/L3), token budget → `mcp/tool-handlers.ts`
- [x] `memory_retrieve_details` — Layer 3 full details for specific entry IDs → `mcp/tool-handlers.ts`
- [x] `memory_ingest` — manual entry creation (enters quarantine) → `mcp/tool-handlers.ts`
- [x] `memory_validate` — trigger validation for specific entry → `mcp/tool-handlers.ts`
- [x] `memory_invalidate` — mark entry as stale/invalidated → `mcp/tool-handlers.ts`
- [x] `memory_poison` — mark entry as confirmed wrong (triggers cascade) → `mcp/tool-handlers.ts`
- [x] `memory_verify` — trace entry back to source evidence (citation provenance) → `mcp/tool-handlers.ts`
- [x] `memory_health` — show system health + quality metrics → `mcp/tool-handlers.ts`
- [x] `memory_diagnose` — identify issues (stale entries, low trust, contradictions) → `mcp/tool-handlers.ts`

**Lifecycle hooks:**

- [x] Implement SessionStart hook → `memory_session_start` tool
- [x] Implement PostToolUse hook → `memory_observe` tool
- [x] Implement PostToolUseFailure hook — capture error context → `memory_observe_failure` MCP tool (privacy-filtered, deduped, source=`failure:<toolName>`)
- [x] Implement Stop hook — trigger post-task extraction → `memory_stop` MCP tool (runs `ExtractionGuard` → if clean, triggers `WorkingToEpisodicConsolidator.consolidate()`)
- [x] Implement SessionEnd hook → `memory_session_end` tool
- [x] `memory_run_invalidation` — run invalidation against recent code changes

**Workflow integration:**

- [x] Define standard task workflow (pre-task retrieval, post-task extraction) → session_start/session_end
- [x] Integrate retrieval into pre-task flow (auto-inject on session start)
- [x] Integrate validation before usage → quarantine system
- [x] Integrate post-task knowledge extraction (with guard: tests must pass) → extraction guard + `memory_stop` MCP tool
- [x] Define memory update flow after merge → agent invokes `memory_run_invalidation` (with `fromRef` = pre-merge commit) on post-merge; orchestrator stales entries whose watched files/symbols changed (see Phase 6 flow). Consumer wires this into their merge CI/hook per `examples/consumer-ci.yml`.
- [x] Separate Working Memory (session) from persistent Semantic/Procedural Memory → consolidation
- [ ] Test with at least 2 different agents (e.g., Claude Code + Augment) — **Pilot-only: requires live sessions from Claude Code + Augment against a shared MCP instance. Blocked until pilot is scheduled.**

**Consumer Integration (from `agent-config` spec: `road-to-consumer-integration-guide.md`):**

- [x] Implement feature detection helper: `memory_status` → `present | absent | misconfigured` → `memory status` CLI
  - `present`: health() responds within 2s
  - `absent`: package not installed or not on PATH (consumer-side shell check)
  - `misconfigured`: installed but health() returns error (typically DB)
- [x] Publish reference `docker-compose.yml` snippet for consumer local dev → `examples/consumer-docker-compose.yml`
- [x] Publish CI job template for consumers → `examples/consumer-ci.yml` (GitHub Actions)
- [x] Ensure CLI is primary V1 contract — MCP wraps CLI, never exposes new surface → MCP tools map 1:1 to CLI commands via shared handlers
- [x] Document consumer prerequisites: Postgres 15+, pgvector, connection string in env var → `README.md` Compatibility section
- [x] Publish compatibility matrix (agent-memory version ↔ agent-config version) in README → `README.md` Compatibility table

### Acceptance Criteria

- Workflow is usable without manual special logic
- Knowledge grows in a controlled way with each completed task
- Any MCP-capable agent can interact with memory
- Lifecycle hooks capture observations automatically
- Token budget respected on session start injection
- Post-task extraction blocked when tests fail
- Consumer can detect memory status (`present`/`absent`/`misconfigured`) reliably

---

## Phase 8: Quality Control & Anti-Drift

### Goal

Memory must remain useful over weeks and months.

### Checklist

- [x] Define metrics → `quality/metrics.ts`
  - [x] Stale detection accuracy (target: >95% for critical/high impact) → staleByImpact
  - [x] Retrieval precision (relevant entries / total returned) → avgTrustScore
  - [x] Contradiction detection rate → unresolvedContradictions
  - [x] Quarantine rejection rate → quarantineRejectionRate
  - [x] Poisoned entry count → poisonedCount
  - [x] TTL compliance → ttlCompliance
  - [x] Never-accessed count (potential waste) → neverAccessedCount
- [x] Build review command → `memory_review` MCP tool
- [x] Build duplicate merge mechanism → `quality/dedup.ts` + `memory_merge_duplicates` tool
- [x] Build contradiction resolution interface → `quality/contradiction-resolution.ts` + `memory_resolve_contradiction` tool
- [x] Define archival strategy (invalidated → archived after 30d) → `quality/archival.ts`
- [x] Introduce scheduled cleanup job → `runArchival()` + `purgeArchived()`
- [x] Build `memory health` command → `memory_health` MCP tool + calculateMetrics
- [x] Build `memory audit` command → `memory_audit` MCP tool

### Acceptance Criteria

- System quality is measurable with concrete numbers
- Stale detection accuracy >95% for critical/high-impact entries
- Bad knowledge doesn't accumulate indefinitely
- Health dashboard shows actionable metrics

---

## Phase 9: Security, Privacy & Team Readiness

### Goal

System is safe for team use.

### Checklist

- [x] Define access scopes (repo-level, team-level) → `security/access-scope.ts`
- [x] Ensure secrets / tokens are never stored in memory → `ingestion/privacy-filter.ts` + audit tests
- [x] Filter PII / sensitive data → `ingestion/privacy-filter.ts` (email, phone, env vars, private tags)
- [x] Enable change log for memory entries → `quality/export.ts` (snapshot + diff)
- [x] Define team review process → `memory_review` + `memory_resolve_contradiction` + `memory_merge_duplicates` tools
- [x] Config hardening: safe parsing, bounds checking, env var overrides → `config.ts`
- [x] Privacy audit tests: 22 tests verifying no sensitive data leaks → `tests/unit/privacy-audit.test.ts`

### Acceptance Criteria

- Critical data never lands in memory
- Entries are auditable

---

## Phase 10: V1 Pilot with Real Repository

### Goal

Prove the system on a real project.

### Prerequisites (from `agent-config` spec: `road-to-agents-md-fix.md`)

- [x] Fix AGENTS.md: remove all Laravel/Galawork references, replace with TypeScript/Node/pgvector stack
- [x] AGENTS.md describes: package layout, npm scripts, public API surface, Postgres setup, relationship to agent-config
- [x] Add "what this repo is NOT" section (not an application, not a UI, not a dataset)

### Checklist

> **Pilot-only items.** Every task in this section requires a live repository, live agents, and human
> judgment of real outputs. The code & infrastructure for V1 are complete; what remains is **execution**.
> The items below cannot be closed autonomously by the agent that built this package — they need a
> human operator with a pilot repo and access to at least two AI coding agents.

- [ ] Select pilot repository — **Pilot-only: human operator selects a real in-house repo**
- [ ] Run initial ingestion — **Pilot-only: `memory ingest` against the selected repo; verify quarantine lands cleanly**
- [ ] Execute 10 real tasks with memory support — **Pilot-only: real tasks from the team's backlog**
- [ ] Document false positives — **Pilot-only: empirical observation during the 10 tasks**
- [ ] Document stale memory occurrences — **Pilot-only: empirical observation during the 10 tasks**
- [ ] Collect developer feedback — **Pilot-only: interviews / survey after the 10 tasks**
- [ ] Test with at least 2 different agents (Claude Code + Augment) — **Pilot-only: requires live sessions from both agents**
- [ ] Create prioritized V2 backlog — **Pilot-only: output of the observations above, written back into this roadmap or a new `agents/roadmaps/v2-backlog.md`**

### Acceptance Criteria

- System saves noticeable discovery time in real tasks
- Stale knowledge is mostly correctly detected
- Agent reading AGENTS.md correctly identifies the TypeScript/Node stack

---

## V2 Possibilities (Out of Scope for V1)

### From agentmemory

- **Team Memory** — namespaced shared + private across team members (`memory_team_share`, `memory_team_feed`)
- **Multi-Agent Coordination** — exclusive action leases, inter-agent signals, sentinels
- **Real-Time Web Viewer** — live observation stream, session explorer, knowledge graph visualization
- **Git-Based Memory Snapshots** — version, rollback, and diff memory state
- **Action System** — work items with dependencies, `memory_frontier` (unblocked by priority), `memory_next`
- **Knowledge Graph Traversal** — entity extraction + BFS traversal as third retrieval stream

### From claude-mem

- **MEMORY.md Bridge** — bi-directional sync between file-based memory (built-in) and database memory
- **Endless Mode** — biomimetic memory architecture for extended sessions (prevents context overflow)

### From agent-config specs

- **Cross-Project Learning (Stage 3)** — anonymised signal feed across consumers; pattern reaches `semantic` in ≥3 projects → proposal PR on agent-config. Options: SaaS aggregator / federated pull / manual meta-review. See `road-to-cross-project-learning.md`
- **REST API** — remote multi-machine setups (V2 only per consumer integration spec)
- **Streaming Responses** — deferred until a consumer hits the 20-entry limit budget
- **Per-Entry No-Decay** — specific entries (e.g. critical security invariants) can declare `no_decay: true`, settable only by human review
- **Negative Signals** — deprecation emits a counter-signal weakening earlier proposals

### Our own

- Symbol-level dependency graph
- PR and ticket integration (Jira, GitHub Issues)
- IDE commands / VS Code extension
- Memory snapshots per release
- Automatic ADR detection
- Test impact analysis
- Tenant / domain-specific memory
- Branch-specific temporary memory

---

## Recommended Execution Order

| # | Phase | Rationale |
|---|---|---|
| 1 | Phase 0 | Decisions first |
| 2 | Phase 1 | Infrastructure |
| 3 | Phase 2 | Storage foundation |
| 4 | Phase 3 | Retrieval (usable immediately) |
| 5 | Phase 4 | Trust (quality gate) |
| 6 | Phase 5 | Ingestion (populate) |
| 7 | Phase 6 | Invalidation (keep fresh) |
| 8 | Phase 7 | MCP + Agent integration |
| 9 | Phase 8 | Quality control |
| 10 | Phase 9 | Security & team |
| 11 | Phase 10 | Pilot |

Rationale: Build storage + retrieval + trust first, then ingestion and invalidation, then workflow and quality.

---

## Minimal V1 Workflow (MCP Tools)

```
1. Session start → memory_session_start(repository, sessionId)
   ← Returns relevant context + runs TTL expiry

2. Agent works on task, observing:
   → memory_observe(sessionId, "Discovered that X uses pattern Y")

3. Query mid-task → memory_retrieve(query, level="L1", tokenBudget=2000)
   ← Returns trust-scored entries within budget

4. Session end → memory_session_end(sessionId, repository)
   ← Consolidates Working→Episodic, runs revalidation

5. After code changes → memory_run_invalidation(fromRef="HEAD~5")
   ← Auto-detects stale memories via git diff + semantic drift
```

---

## Definition of Done for V1

V1 is reached when:

- Memory entries are stored in a structured way with evidence and trust
- Hybrid retrieval returns useful results
- Trust status is visible on every entry
- Git diffs trigger invalidation
- At least one agent (any) is integrated via MCP or CLI
- A pilot repository has been successfully tested

---

## Acceptance Criteria (Roadmap)

- [x] All Phase 0 decisions documented as ADR → `agents/adrs/`
- [x] All Safety Rules implemented and enforced (no bypass) → quarantine, privacy filter, extraction guard, trust threshold
- [x] Working CLI + MCP server → 17 MCP tools via stdio transport
- [x] Quarantine flow works — no entry goes directly to `validated` → `memory-entry.repository.ts` creates with `quarantine` status
- [x] TTL expiry enforced — expired entries auto-stale → `ttl-expiry-job.ts`, runs on `memory_session_start`
- [x] Contradiction detection active on ingestion + retrieval → `contradiction.service.ts` + `ingestion/pipeline.ts`
- [x] Post-task extraction blocked when tests fail → `extraction-guard.ts`
- [x] Audit trail complete — every status change traceable → `memory_status_history` table + `memory_audit` tool
- [x] Trust threshold enforced — below 0.6 never returned to agents → `config.trust.thresholdDefault`
- [ ] 10+ real tasks completed with memory support — **requires Phase 10 pilot**
- [ ] Stale detection accuracy >95% for critical/high-impact entries — **requires Phase 10 pilot data**
- [ ] Zero poisoned entries remain active (all caught and cascaded) — `poison.service.ts` implemented, **needs pilot verification**
- [ ] At least 2 different agents tested via MCP — **requires Phase 10 pilot**
- [x] `memory health` shows all quality metrics green → `memory_health` + `calculateMetrics()`

## Integration Specs (from `agent-config`)

The following specs were authored in `agent-config` and define the **contract** between the two packages.
They have been integrated into the phases above. Shipped specs are archived in
[`agents/roadmaps/archive/from-agent-config/`](archive/from-agent-config/);
the one deferred spec remains in [`agents/roadmaps/from-agent-config/`](from-agent-config/).

| Spec | Integrated Into | Status |
|---|---|---|
| [`road-to-retrieval-contract.md`](archive/from-agent-config/road-to-retrieval-contract.md) | Phase 3 (Retrieval Contract) | ✅ Shipped — `src/retrieval/contract.ts`, schemas + 20 conformance tests |
| [`road-to-promotion-flow.md`](archive/from-agent-config/road-to-promotion-flow.md) | Phase 4 (Promotion Flow) | ✅ Shipped — `src/trust/promotion.service.ts` + 4 MCP tools |
| [`road-to-decay-calibration.md`](archive/from-agent-config/road-to-decay-calibration.md) | Phase 4 (Decay Calibration) | ✅ Shipped — `src/trust/decay.ts` + per-type overrides + 14 tests |
| [`road-to-consumer-integration-guide.md`](archive/from-agent-config/road-to-consumer-integration-guide.md) | Phase 7 (Consumer Integration) | ✅ Shipped — `memory status` + `memory health` CLI with contract envelopes |
| [`road-to-agents-md-fix.md`](archive/from-agent-config/road-to-agents-md-fix.md) | Phase 10 (Prerequisites) | ✅ Shipped — AGENTS.md rewritten for TS/Node/pgvector stack |
| [`road-to-cross-project-learning.md`](from-agent-config/road-to-cross-project-learning.md) | V2 Possibilities | Deferred — requires 2+ production consumers |

## Notes

- The system is agent-agnostic by design: any model (GPT, Claude, Gemini, etc.) and any agent (Augment, Cursor, Cline, etc.) can use it
- MCP (Model Context Protocol) is the primary integration mechanism — supported by most modern agents
- CLI is the primary V1 contract; MCP wraps the CLI (from consumer integration spec)
- The original German roadmap is archived in [`agents/roadmaps/archive/augment-agent-memory-hybrid-roadmap.md`](archive/augment-agent-memory-hybrid-roadmap.md)
- Shipped integration specs are archived in [`agents/roadmaps/archive/from-agent-config/`](archive/from-agent-config/); the single deferred spec remains in [`agents/roadmaps/from-agent-config/`](from-agent-config/)