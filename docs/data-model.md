# Data Model

`agent-memory` stores everything in **PostgreSQL 15+** with the
[`pgvector`](https://github.com/pgvector/pgvector) extension. 8 tables, all
created by `npm run db:migrate`.

## Tables

### `memory_entries` — the core table

One row per piece of knowledge. Every ingested memory lands here.

| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | auto |
| `type` | TEXT | one of 9 [memory types](#memory-types) |
| `title` | TEXT | short human label |
| `summary` | TEXT | one-paragraph canonical statement (shown in L2 retrieval) |
| `details` | TEXT nullable | long-form (shown in L3 retrieval only) |
| `scope` | JSONB | `{ files[], symbols[], modules[], repository }` |
| `impact_level` | TEXT | `critical \| high \| normal \| low` |
| `knowledge_class` | TEXT | `evergreen \| semi_stable \| volatile` — drives decay |
| `consolidation_tier` | TEXT | `working \| episodic \| semantic \| procedural` |
| `embedding_text` | TEXT | text that was embedded |
| `embedding` | `vector(384)` | nullable when provider is `bm25-only` |
| `trust_status` | TEXT | see [Trust Lifecycle](#trust-lifecycle) |
| `trust_score` | REAL | 0.0–1.0 |
| `validated_at` | TIMESTAMPTZ nullable | when validators last passed |
| `expires_at` | TIMESTAMPTZ | TTL; auto-stale after this |
| `access_count` | INTEGER | bumped on retrieval — feeds decay-hit refresh |
| `last_accessed_at` | TIMESTAMPTZ nullable | for decay bookkeeping |
| `created_by` | TEXT | caller id, e.g. `cli:propose`, `mcp:memory_ingest` |
| `created_in_task` | TEXT nullable | task/session id — used by rollback |
| `promotion_metadata` | JSONB | gate inputs from propose: `{ futureScenarios, source, gateCleanAtProposal }` |

**Indexes:** `type`, `trust_status`, `consolidation_tier`, `expires_at`, `impact_level`.

### `memory_observations` — Working Memory

Raw tool observations inside an agent session. Deduplicated by SHA-256 hash
within a UTC-day window (unique index). Rolled up into `memory_episodes` at
session end.

### `memory_episodes` — Episodic Memory

Session-level summaries. Created by the `working → episodic` consolidation
step. Bridge between volatile Working Memory and durable `memory_entries`.

### `memory_evidence` — proof links

Cites what backs each entry: ADR file, git SHA, test file, PR url, incident
id. `memory_verify` traces entries back through this table.

| Column | Notes |
|---|---|
| `kind` | e.g. `adr`, `test`, `git_commit`, `pr`, `incident` |
| `ref` | the actual reference (path, SHA, url) |
| `verified_at` | when a validator last confirmed the ref resolves |

Cascades on `memory_entries` delete.

### `memory_links` — scope associations

Many-to-many between entries and files / symbols / modules. Used by the
invalidation engine: `git diff` on a file marks linked entries stale;
signature drift (stored in `signature` column) triggers hard invalidation.

### `memory_status_history` — audit trail

Append-only. Every trust-status transition writes `{from, to, reason, triggered_by}`.
Feeds `memory_audit` and the rollback report.

### `memory_contradictions` — conflict pairs

Pairs of entries that overlap and disagree. Resolution strategies:
`keep_a`, `keep_b`, `keep_both`, `reject_both` (see `memory_resolve_contradiction`).

### `memory_migrations` — schema versioning

Tracks applied migrations by name.

## Trust Lifecycle

```
  quarantine → validated → stale → invalidated → archived
       ↓                     ↓
    rejected              poisoned (cascade)
```

- **quarantine** — default for every new entry. Not served by `retrieve`.
- **validated** — passed gate criteria: ≥1 evidence ref, all validators green.
- **stale** — TTL expired or `softInvalidate` triggered. Still retrievable with `--low-trust`.
- **invalidated** — hard failure (e.g. signature drift, symbol deleted). Not served.
- **rejected** — explicit human/agent rejection during promote.
- **poisoned** — confirmed wrong. Cascade: every entry derived via evidence links gets reviewed (see [`src/invalidation/rollback.ts`](../src/invalidation/rollback.ts)).
- **archived** — kept for audit, never served.

Transitions are enforced in [`src/trust/transitions.ts`](../src/trust/transitions.ts).

## Consolidation Tiers

| Tier | Source | Retention | Purpose |
|---|---|---|---|
| `working` | `memory_observations` | session | raw tool events, deduped |
| `episodic` | `memory_episodes` | 30 days default | session summaries |
| `semantic` | `memory_entries` (most) | 90d–∞ by `knowledge_class` | durable project knowledge |
| `procedural` | `memory_entries` | ∞ | repeated workflows, rarely decayed |

Promotion is run at session-end (`memory_stop` MCP tool) via
[`src/consolidation/tier-promotion.ts`](../src/consolidation/tier-promotion.ts).

## Decay (Ebbinghaus)

Trust score decays over time unless refreshed by retrieval hits. Per-type
overrides in `MEMORY_DECAY_OVERRIDES` (see [configuration](configuration.md)).
Default half-lives: `evergreen` = 180d, `semi_stable` = 30d, `volatile` = 7d.

- Retrieval hit → `trust_score` + `refresh_boost` (capped at 1.0), `last_accessed_at` updated.
- No hit + TTL passed → status → `stale`.
- `evergreen` + `architecture_decision` (ADRs) → no decay at all (see [`src/trust/decay.ts`](../src/trust/decay.ts)).

## Memory Types

| Type | Typical use |
|---|---|
| `architecture_decision` | ADRs, long-lived design choices |
| `domain_rule` | business invariants |
| `coding_convention` | project style, module layout |
| `bug_pattern` | known failure modes + fix |
| `refactoring_note` | in-progress migrations, temporary shims |
| `integration_constraint` | external API limits, version pins |
| `deployment_warning` | ops caveats, rollout order |
| `test_strategy` | how a module is tested |
| `glossary_entry` | project vocabulary |

Defined in [`src/types.ts`](../src/types.ts) (`MEMORY_TYPES` const).
