# Glossary

Every term used in README, AGENTS.md, and the docs with a single
definition and a source-of-truth pointer. If a concept is not here,
either it does not exist in the codebase yet or this file is out of
date — either way, open an issue.

## Memory structure

- **Memory entry** — a single piece of project knowledge. Row in
  `memory_entries`. Every entry has a `type`, a `trust_score`, and a
  `trust_status`. Interface: `MemoryEntry` in [`src/types.ts`](../src/types.ts).
- **Memory type** — the kind of knowledge. One of 9 values: `architecture_decision`,
  `domain_rule`, `coding_convention`, `bug_pattern`, `refactoring_note`,
  `integration_constraint`, `deployment_warning`, `test_strategy`,
  `glossary_entry`. Source: `MEMORY_TYPES` in [`src/types.ts`](../src/types.ts).
- **Scope** — which files / symbols / modules an entry applies to.
  Used by the invalidation engine to mark entries stale on `git diff`.
  Interface: `MemoryScope`.
- **Evidence** — a proof reference (`adr`, `file`, `commit`, `test`,
  `documentation`, `symbol`) attached to an entry. Row in
  `memory_evidence`. Minimum count depends on `impact_level`. Enum:
  `EVIDENCE_KINDS`.
- **Observation** — a raw tool observation inside a session. Stored in
  `memory_observations`, deduplicated by SHA-256 per UTC day, rolled up
  into an episode at session end.
- **Episode** — a session-level summary. Bridge between Working and
  Semantic memory. Row in `memory_episodes`.

## Trust lifecycle

- **`trust_score`** — a real number 0.0–1.0. Retrieval filters entries
  below `MEMORY_TRUST_THRESHOLD_DEFAULT` (default `0.6`). Decays over
  time unless refreshed by retrieval hits.
- **`trust_status`** — enum, one of: `quarantine`, `validated`, `stale`,
  `invalidated`, `rejected`, `poisoned`, `archived`. Transitions
  enforced in [`src/trust/transitions.ts`](../src/trust/transitions.ts).
  Source: `TRUST_STATUSES`.
- **Quarantine** — default status for every new entry. **Not** served
  by `retrieve`. Exits to `validated` (passed gate) or `rejected`.
- **Gate criteria** — the checks an entry must pass to leave
  quarantine: `≥ MIN_EVIDENCE_COUNT[impact_level]` evidence refs, all
  four validators green (`file-exists`, `symbol-exists`, `diff-impact`,
  `test-linked`), and — above `low` impact — `≥ MIN_FUTURE_SCENARIOS`
  (=3) proposed future scenarios.
- **Validated** — passed gate. Retrievable. Subject to decay.
- **Stale** — TTL expired, or `softInvalidate` triggered. Still
  retrievable with `--low-trust`. Refreshed on hit → back to `validated`.
- **Invalidated** — hard failure (symbol deleted, signature drift).
  Not served.
- **Poisoned** — confirmed wrong. Triggers **rollback cascade**: every
  entry whose evidence chain contains the poisoned entry is marked for
  review. See [`src/invalidation/rollback.ts`](../src/invalidation/rollback.ts).
- **Archived** — kept for audit only. Never served.

## Scoring & lifecycle mechanics

- **Impact level** — `critical | high | normal | low`. Drives minimum
  evidence count (2 / 1 / 1 / 0) and the single-evidence trust-score
  cap (0.7 / 0.85 / 1.0 / 1.0). Enum: `IMPACT_LEVELS`.
- **Knowledge class** — `evergreen | semi_stable | volatile`. Drives
  decay half-life and TTL caps. Enum: `KNOWLEDGE_CLASSES`.
- **TTL** (time-to-live) — when an entry transitions to `stale`.
  `TTL_DAYS` per knowledge class: evergreen = 90d, semi_stable = 30d,
  volatile = 7d. Extended by recent access via `TTL_BOOST_PER_10_ACCESSES`,
  capped at `TTL_CAP_DAYS`.
- **Decay** — the gradual reduction of `trust_score` over time, separate
  from TTL. Default half-lives: evergreen = 180d, semi_stable = 30d,
  volatile = 7d. `architecture_decision` + `evergreen` never decays.
  See [`src/trust/decay.ts`](../src/trust/decay.ts).
- **Ebbinghaus** — the forgetting-curve model behind decay. Refreshing
  memory on retrieval delays decay; long inactivity accelerates it.
- **Consolidation tier** — `working | episodic | semantic | procedural`.
  Where an entry lives in the lifecycle hierarchy. Enum:
  `CONSOLIDATION_TIERS`.
- **Promotion** — the transition `working → episodic → semantic`, run
  at session end by [`src/consolidation/tier-promotion.ts`](../src/consolidation/tier-promotion.ts).

## Retrieval

- **Progressive disclosure** — L1 (index: title + type + score), L2
  (summary — default), L3 (full details). Picks the level that fits
  the token budget.
- **RRF** — Reciprocal Rank Fusion. Combines BM25 (lexical) and vector
  (semantic) rankings into a single ordering. See
  [`src/retrieval/engine.ts`](../src/retrieval/engine.ts).
- **BM25** — the lexical search component. Fallback when no embedding
  provider is configured (`EMBEDDING_PROVIDER=bm25-only`).

## Safety & hygiene

- **Privacy filter** — strips secrets, API keys, PII before any text
  hits the DB. See [`src/ingestion/privacy-filter.ts`](../src/ingestion/privacy-filter.ts).
- **Extraction guard** — the pre-proposal check that tests pass, quality
  tools are green, and the diff is not only deletions. Recorded as
  `promotionMetadata.gateCleanAtProposal`.
- **3-future-decisions heuristic** — to promote above `low` impact an
  agent must list at least 3 plausible future scenarios the entry will
  inform. `MIN_FUTURE_SCENARIOS = 3`.
- **Poison** — the verb for marking an entry as confirmed wrong.
  Triggers a rollback cascade through evidence links.

## API & contract

- **MCP tool** — one of the 23 `memory_*` tools exposed over stdio.
  Registered in [`src/mcp/tool-definitions.ts`](../src/mcp/tool-definitions.ts).
- **CLI command** — one of the 14 `memory <verb>` subcommands. JSON
  on stdout, exit code 0 on success. Registered in
  [`src/cli/index.ts`](../src/cli/index.ts).
- **`contract_version`** — the schema version of `retrieve()`,
  `propose()`, `promote()`, `health()` responses. Currently `1`.
  Breaking renames bump the major; additive fields do not.
  Reference: [retrieval contract spec](../agents/roadmaps/archive/from-agent-config/road-to-retrieval-contract.md).

## See also

- [`data-model.md`](data-model.md) — full Postgres schema.
- [`cli-reference.md`](cli-reference.md) — every CLI command.
- [`configuration.md`](configuration.md) — every env variable.
