# Phase 0 — Audit & Baseline Outputs

Working notes for `agents/roadmaps/archive/improve-system.md`. Not user-facing.
Regenerate by re-running the commands below before declaring Phase 0 done.

## P0-1 · Universality drift (file:line)

Source command: `grep -rniE "laravel|artisan|eloquent|...|\bphp\b" README.md AGENTS.md docs/ examples/`

| File | Line | Issue | Phase 1 task |
|---|---|---|---|
| `README.md` | 44 | "PHP / Laravel →" bullet elevates stack | P1-1 |
| `README.md` | 73 | compat row "PHP / Laravel (any language, really)" | P1-1 |
| `README.md` | 141 | "regardless of language (PHP, Python, Go, …)" — enumeration order | P1-1 |
| `AGENTS.md` | 16 | "Not Laravel / PHP / MariaDB" negative framing | P1-6 |
| `docs/consumer-setup-php.md` | 1-130 | entire file PHP/Laravel-framed | P1-2 |
| `docs/consumer-setup-node.md` | 66 | "matches the CLI contract consumed by `agent-config`" | P1-8 |
| `docs/consumer-setup-node.md` | 175 | link to old `consumer-setup-php.md` | P1-2 inbound |
| `docs/media/record-demo.sh` | 73 | ASCII banner text `"docs/consumer-setup-{node,php}.md"` | P1-2 inbound |
| `examples/php-laravel-sidecar/*` | — | whole dir name + 4 files Laravel-framed | P1-4 |

**README compat table (lines 317-319):** lists `agent-config` as a column
alongside Node/Postgres. → P1-7.

## P0-2 · Data model vs `src/types.ts`

Source of truth: `src/types.ts`. Compared against `docs/data-model.md`.

| Finding | Truth | Doc | Fix |
|---|---|---|---|
| EVIDENCE_KINDS values | `file, commit, test, adr, documentation, symbol` | `adr, test, git_commit, pr, incident` | P0 → flag for P2-2 glossary + doc patch |
| TTL_DAYS evergreen | `90` | "half-life `evergreen` = 180d" | clarify: TTL_DAYS (90) ≠ decay half-life; doc conflates; P2-2 glossary |
| Count of `memory_*` tables | 8 (migrations) | "8 tables" | ✓ match |
| Memory types | 9 | "9 memory types" | ✓ match |
| `impact_level` values | `critical, high, normal, low` | matches | ✓ |
| `knowledge_class` values | `evergreen, semi_stable, volatile` | matches | ✓ |
| `consolidation_tier` values | `working, episodic, semantic, procedural` | matches | ✓ |
| `trust_status` values | 7 (`quarantine, validated, stale, invalidated, rejected, poisoned, archived`) | matches | ✓ |

**Action:** `docs/data-model.md` needs two patches during P2-2 (glossary
pass): EVIDENCE_KINDS list and "half-life vs TTL" clarification.

## P0-3 · Concept inventory (seed for `docs/glossary.md`)

Extracted from `src/types.ts` and roadmap docs:

**Enums (from `src/types.ts`):**
- `MemoryType` (9) · `ImpactLevel` (4) · `KnowledgeClass` (3)
- `ConsolidationTier` (4) · `TrustStatus` (7) · `EvidenceKind` (6)

**Scoring / lifecycle terms:**
- `trust_score` (0-1 real)  ·  `trust_status` (enum)  ·  `gate criteria`
- `quarantine` (trust_status)  ·  `poison` (cascade invalidation)
- `progressive disclosure` (L1/L2/L3 retrieval)  ·  `RRF` (reciprocal rank fusion)
- `decay half-life` vs `TTL` (distinct — doc currently conflates)
- `Ebbinghaus` (decay model)  ·  `rollback cascade` (poison consequence)
- `contract_version` (retrieve/propose/promote/health v1)
- `extraction guard` (tests + quality-tool + no-only-deletions check)
- `knowledge_class` drives decay  ·  `impact_level` drives evidence minima

**Config values (from `src/types.ts`):**
- `MIN_EVIDENCE_COUNT` (per impact)  ·  `TRUST_SCORE_CAP_SINGLE_EVIDENCE`
- `TTL_DAYS`  ·  `TTL_BOOST_PER_10_ACCESSES`  ·  `TTL_CAP_DAYS`
- `MIN_FUTURE_SCENARIOS = 3` (3-future-decisions heuristic)

Glossary target: **~25 entries**.

## P0-4 · Drift inventory (hardcoded numbers in docs)

| File:Line | Claim | Truth | Action |
|---|---|---|---|
| `README.md:6` | "240 tests passing" | ~225 `it()` calls; need `npm test` for authoritative count | P3-5 fix + P6-1 guard |
| `README.md:59` | "23 MCP tools" | 23 (matches `tool-definitions.ts`) | ✓ — P6-2 guard needed |
| `README.md:60` | "14 CLI commands" | 14 (matches `src/cli/index.ts`) | ✓ — P6-3 guard needed |
| `README.md:293` | source-tree comment "17 tools" | wrong — should be 23 | P3-5 fix |
| `AGENTS.md:9` | "23 tools" | ✓ | — |
| `AGENTS.md:25` | "240 tests passing" | same issue as README:6 | P3-5 fix + P6-1 guard |
| `AGENTS.md:98` | source-tree "23 tools" | ✓ | — |

**MCP_PORT vaporware (P3-6):**
- `src/config.ts:63` — parsed but unused in code flow
- `docs/configuration.md:87` — "reserved for future HTTP transport"
- `.env.example:22` — documented

**REPO_ROOT semantic mismatch (P3-7):**
- `README.md:154, 173` — MCP client config shows `"/abs/path/to/your/project"` (host path) — OK for npm-install path
- `docs/consumer-setup-php.md:68`, `examples/php-laravel-sidecar/docker-compose.yml:41` — uses `/workspace` (container path) — OK for sidecar pattern
- No doc explicitly states the two modes; a reader mixing patterns breaks validators

## Must-address before Phase 1 starts

1. Open `docs/media/record-demo.sh` when touching P1-2 (ASCII banner reference).
2. `docs/data-model.md` patches are deferred to P2-2, not a Phase-1 blocker.
3. Authoritative test count must come from `npm test --reporter=json` during P3-5 (do not commit `225` — the grep-based count undercounts).

## Ground-truth commands (for guards P6-1..P6-3)

```bash
# MCP tool count
grep -cE "^\s*name:\s*['\"]" src/mcp/tool-definitions.ts

# CLI command count
grep -cE "^\s*\.command\(" src/cli/index.ts

# Test count (authoritative)
npm test -- --reporter=json | jq '.numTotalTests'
```

## Status

- [x] P0-1 done
- [x] P0-2 done
- [x] P0-3 done
- [x] P0-4 done
