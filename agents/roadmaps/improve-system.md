# Roadmap — improve-system

**Branch:** `feat/improve-system`
**Release target:** `1.0.1` (patch) — docs, fixes, universality only.
Feature-scale tasks (new CLI subcommands, programmatic exports, runtime
behaviour) are tracked here but scheduled for a follow-up `1.1.0` minor.
**Rename policy:** hard renames, no redirect stubs — tag `1.0.0` is
two days old and no external links to the renamed paths are in the wild.

## Goal

Lift `@event4u/agent-memory` from "V1 complete, Node+PHP/Laravel-biased"
to **universal, polished, production-grade** — stack-agnostic
positioning, concept clarity, governance hygiene, and drift-prevention
extended to the new surface area.

## Guiding principles

1. **Stack-agnostic first.** `agent-memory` is a TypeScript/Node binary
   that runs anywhere Docker or Node runs. Every doc path, example name,
   and positioning line must reflect this. PHP/Laravel is *one* stack
   among many — not a headline.
2. **`agent-config` is a companion, not a prerequisite.** Every doc
   path must work for a consumer who never heard of `agent-config`.
   Integration gets its own dedicated story, not scattered implications.
3. **Concept clarity before feature growth.** Glossary, diagrams,
   non-goals, and comparisons ship before any new runtime feature.
4. **Drift prevention scales with scope.** Every new claim in a doc
   (tool count, command count, compatibility, test count) gets a
   CI guard — or it's a future drift incident waiting to happen.

## Priority legend

- **[Must]** — blocks the `1.0.1` release. Without these, no tag.
- **[Should]** — in the `1.0.1` cycle if time allows, otherwise the
  first thing to pull into `1.1.x` or `1.1.0`.
- **[Could]** — deferred to `1.1.0` or later by design. Feature-scale
  work that does not fit a patch release, or polish that adds value
  but isn't gating.

Nothing gets dropped. Priority controls **sequence and release
pinning**, not scope.

## Phase overview

| Phase | Theme                                  | Tasks | Cycle    |
|-------|----------------------------------------|-------|----------|
| P0    | Audit & baseline                       |   4   | 1.0.1    |
| P1    | Universality refactor (core directive) |   8   | 1.0.1    |
| P2    | Reviewer gaps & concept clarity        |   5   | 1.0.1    |
| P3    | Technical smoothing (first-run & DX)   |   7   | mixed    |
| P4    | Governance & release hygiene           |   5   | 1.0.1    |
| P5    | `agent-config` integration story       |   4   | 1.0.1+   |
| P6    | Drift-prevention extension             |   6   | 1.0.1+   |
| P7    | Release                                |   3   | 1.0.1    |

Total: **42 tasks** (revised from 38 after mapping — see notes per task).
Of these, **22 are [Must]**, blocking the 1.0.1 tag.

---

## Phase 0 — Audit & Baseline

Foundation for everything else. No user-facing output yet — these
produce the working notes that subsequent phases execute against.

### P0-1 · Universality sweep [Must]

- **Why:** The audit already surfaced 8 stack-bias points; a systematic
  sweep across every `.md` in `README.md`, `AGENTS.md`, `docs/`, and
  `examples/` is needed to avoid whack-a-mole in Phase 1.
- **Scope:** Grep for `laravel|artisan|eloquent|blade|livewire|\bphp\b`
  case-insensitive; produce `agents/analysis/universality-sweep.md`
  with file:line citations grouped by fix category.
- **Done:** The sweep file exists and every hit is categorised as
  `keep-as-example | neutralise | rename | delete`.

### P0-2 · `docs/data-model.md` content review [Must]

- **Why:** Not audited in the pre-roadmap phase. Referenced by README
  twice as "full details" — has to be accurate and version-aligned.
- **Scope:** Read end-to-end, compare against `src/types.ts`,
  `src/db/migrations/`, and `src/trust/`.
- **Done:** List of discrepancies (if any) attached to this roadmap
  as `P0-2-findings`. If clean, mark as verified.

### P0-3 · Concept inventory [Must]

- **Why:** Seeds the glossary (P2-2). `trust_score`, `quarantine`,
  `gate`, `poison`, `knowledge_class`, `impact_level`, `contract_version`
  and related terms live in `src/types.ts` enums and scattered docs.
- **Scope:** Extract every enum value and exported type from
  `src/types.ts` + `src/trust/types.ts`; produce a raw term list.
- **Done:** `agents/analysis/concept-inventory.md` has all terms,
  source file, and one-line "current definition state" (documented /
  implied / undefined).

### P0-4 · Drift inventory [Must]

- **Why:** README hardcodes `23 MCP tools`, `14 CLI commands`,
  `240 tests`, `17 tools` (inconsistency with itself on line 293),
  `v0.1.x` compatibility row. All will drift. Need a list before
  Phase 6 designs guards.
- **Scope:** Enumerate every hardcoded count, version, or numeric
  claim in `README.md`, `AGENTS.md`, `docs/*.md`.
- **Done:** `agents/analysis/drift-inventory.md` with one row per
  claim: location, value, source-of-truth command, proposed guard.

---

## Phase 1 — Universality Refactor

Executes against P0-1's sweep. This is the core user directive —
every task ships in `1.0.1`.

### P1-1 · README positioning neutralisation [Must]

- **Why:** Current README (lines 41-47, 68-74) frames integration as a
  PHP/Laravel-vs-Node dichotomy with "any MCP client" as a fallback.
  Invert: universal is the default, stack-specific snippets are
  examples of the universal pattern.
- **Scope:** Rewrite the "Integrate with your project" section.
  Lead with the Docker sidecar + MCP config that works for any
  language. List stacks (PHP, Python, Go, Ruby, Rust, .NET, Node, …)
  as equal rows in a table linking to the **same** generic guide
  with per-stack snippets.
- **Done:** README "Integrate" section passes the
  universality-guard grep (no stack elevated above others in prose),
  and every stack row links to a snippet that actually exists.

### P1-2 · Rename `docs/consumer-setup-php.md` → `docs/consumer-setup-docker-sidecar.md` [Must]

- **Why:** Title "Consumer setup — PHP / Laravel" and 13 Laravel/PHP
  terms make this file read like a Laravel manual. The actual content
  (Docker sidecar next to any app) is stack-agnostic.
- **Scope:** Hard rename (no redirect stub). Retitle to "Consumer
  setup — Docker sidecar (any stack)". Keep the Laravel code snippet
  in §3 as *one* of several examples (PHP/Symfony CLI, Python,
  Go, bash). Update every inbound reference (README line 44, 73;
  examples/README; consumer-setup-node.md line 175).
- **Done:** Old file gone, new file exists, `npm run check:links`
  passes, generic title + multi-stack snippet section in §3.

### P1-3 · New `docs/consumer-setup-generic.md` [Must]

- **Why:** There is no "I have an app in language X and want to use
  agent-memory" entry point that isn't framed through Node or PHP.
- **Scope:** Write a short guide (≤150 lines) that covers the two
  universal patterns: (a) Docker sidecar + `docker compose exec
  agent-memory memory …` for CLI, (b) MCP client pointed at
  `docker compose exec -i agent-memory memory mcp`. Language-neutral
  examples only.
- **Done:** File exists, links from README "Integrate" table, no
  language-specific code blocks outside an explicit "Examples per
  language" footer section.

### P1-4 · Rename `examples/php-laravel-sidecar/` → `examples/laravel-sidecar/` [Must]

- **Why:** The directory name implies Laravel is the canonical PHP
  path. Laravel is one framework — the example is a Laravel example,
  not *the* PHP example.
- **Scope:** Hard rename. Update references in README line 73,
  `examples/README.md`, `docs/consumer-setup-docker-sidecar.md`
  (after P1-2).
- **Done:** Directory renamed, references updated, link-check passes.

### P1-5 · New `examples/python-sidecar/` + `examples/standalone-cli/` [Should]

- **Why:** Balances the example portfolio so no single stack is over-
  represented. Demonstrates the universal pattern concretely.
- **Scope:** `python-sidecar/` — minimal `docker-compose.yml` +
  `app.py` that calls `docker compose exec agent-memory memory …`
  via `subprocess` and parses JSON. `standalone-cli/` — a bash-only
  example showing how to use the CLI from any shell environment
  without any language runtime.
- **Done:** Both examples boot with `docker compose up -d` and end
  with a working `memory health → status: ok`.

### P1-6 · AGENTS.md stack-agnostic affirmation [Must]

- **Why:** Line 16 says "Not Laravel/PHP/MariaDB — if you see those
  references, they are stale". Negative framing. The repo needs a
  positive affirmation of universality in the same place.
- **Scope:** Replace line 16's negative "Not X" bullet with an
  affirmative "Stack-agnostic: runs as a Docker sidecar, a Node
  library, or a standalone CLI — usable from any language that can
  spawn a subprocess or speak MCP stdio." Keep the negative list for
  "Not a SaaS / Not a dataset" (those are still useful).
- **Done:** AGENTS.md has an affirmative universality sentence;
  reviewer audit cannot find a "Node or PHP"-flavoured framing.

### P1-7 · README compatibility table — `agent-config` out of dimensions [Must]

- **Why:** Lines 317-319 list `agent-config` as a compatibility
  dimension alongside Node and Postgres, implying dependency.
  `agent-config` is an optional companion.
- **Scope:** Drop the `agent-config` column from the compatibility
  matrix. Move the version-pairing into a separate "Optional
  companion — `agent-config`" subsection that references the
  future `docs/compatibility-matrix.md` (P5-4).
- **Done:** Compatibility table has rows only for runtime deps
  (Node, Postgres, Docker); `agent-config` has its own subsection
  clearly marked optional.

### P1-8 · `docs/consumer-setup-node.md` — agent-config neutralisation [Must]

- **Why:** Line 66 "matches the CLI contract consumed by `agent-config`"
  can imply `agent-config` is the expected consumer.
- **Scope:** Rephrase to "matches the stable CLI contract — any
  consumer (your own code, `agent-config`, a CI script) sees the
  same output shape." One sentence change.
- **Done:** Node guide reads neutrally; `agent-config` referenced as
  one consumer example among others.

---

## Phase 2 — Reviewer Gaps & Concept Clarity

External reviewer identified 4 gaps. Two were false positives
(.env.example exists, embedding providers documented). These are the
real ones plus two cross-cutting clarity tasks.

### P2-1 · Architecture diagram in README [Must]

- **Why:** README has only an ASCII lifecycle flow. The 4-tier model
  (Working → Episodic → Semantic → Procedural) plus trust lifecycle
  plus data flow is the product's core — must be visible in 60 s.
- **Scope:** Add a single Mermaid diagram to README under "How it
  works". Show: ingest → quarantine → gate → validated → decay/invalidate
  → archived, plus the 4 tiers as parallel swimlanes. Keep the ASCII
  diagram for environments without Mermaid render.
- **Done:** Mermaid block renders on GitHub; reviewer pass confirms
  "I understand the model in 60 s".

### P2-2 · `docs/glossary.md` [Must]

- **Why:** `trust_score`, `quarantine`, `gate criteria`, `poison`,
  `knowledge_class`, `impact_level`, `contract_version`, `progressive
  disclosure`, `RRF`, `decay half-life`, `Ebbinghaus`, `rollback
  cascade` — none centrally defined. P0-3 produces the seed list.
- **Scope:** One entry per term: definition, source of truth
  (`src/types.ts` enum or relevant doc), example value. Linked from
  README and AGENTS.md.
- **Done:** Every term from P0-3 inventory has an entry; reviewer
  can look up any unfamiliar word from README in one click.

### P2-3 · `docs/comparisons.md` [Should]

- **Why:** Reviewer-requested; prospective users ask "how does this
  differ from X" before adopting. Silence on the question is worse
  than an honest comparison.
- **Scope:** 4-column table: this repo · `neo4j-labs/agent-memory`
  · `basic-memory` · `OpenMemory MCP` · Letta/MemGPT. Rows:
  persistence, trust scoring, decay, invalidation, MCP support,
  stack-agnostic integration, license. Honest — do not cherry-pick.
- **Done:** Table published; each competitor linked; every row
  has a cited basis (their README or docs).

### P2-4 · "Non-goals" section in README [Must]

- **Why:** Protects against misaligned expectations ("is this a
  general vector DB? a pretrained model? a SaaS?"). AGENTS.md has
  a "Not a …" section; README does not.
- **Scope:** 5-7 line section near the top, after "What you get".
  Explicit: not a general-purpose vector DB, not a model, not a
  SaaS, not a replacement for project documentation.
- **Done:** Section present; wording aligned with AGENTS.md line 13-17.

### P2-5 · `docs/tutorial-first-memory.md` [Should]

- **Why:** Every guide is a reference; there is no narrative
  "zero → first useful memory" walkthrough.
- **Scope:** 100-line tutorial: start Docker, run `memory doctor`,
  ingest one `architecture_decision`, retrieve it, watch the trust
  score, simulate a git change that invalidates it. Narrative, not
  reference.
- **Done:** Tutorial runs end-to-end from a fresh clone in < 5 min;
  linked from README quick-start as "Want the guided tour?".

---

## Phase 3 — Technical Smoothing (First-Run & DX)

Mixed cycle. **Fix-scale tasks stay in 1.0.1** (patch). **Feature-scale
tasks (new CLI subcommands, programmatic exports, runtime behaviour
changes) move to 1.1.0** — semver correctness.

### P3-1 · New `memory migrate` CLI subcommand [Could → 1.1.0]

- **Why:** `docs/consumer-setup-node.md` currently tells consumers to
  run `node node_modules/@event4u/agent-memory/dist/db/migrate.js` —
  an internal path. Breaks on package reorganisation.
- **Scope:** New Commander subcommand `memory migrate` that invokes
  the existing migration runner. JSON on stdout, exit code 0/1.
  Idempotent. Update Node guide `§5` to use it.
- **Done:** `memory migrate` works from Docker sidecar and npm
  install; Node guide no longer references internal `dist/` paths.

### P3-2 · Programmatic `runMigrations()` export [Could → 1.1.0]

- **Why:** Node-guide §5 states "A stable `runMigrations`
  programmatic export is tracked for v0.2." — make good on that.
- **Scope:** Export `runMigrations(opts?: { databaseUrl?: string })`
  from package root. Idempotent, returns applied migration list.
- **Done:** Import works from a fresh consumer install;
  tests cover idempotence and custom `databaseUrl`.

### P3-3 · Container auto-migrate on first start [Could → 1.1.0]

- **Why:** Current container runs `tail -f /dev/null` and ships an
  empty DB until someone `docker compose exec`s migrate manually.
  First-run UX: user runs `memory health`, gets "migrations pending".
- **Scope:** Entrypoint script: wait for Postgres, run migrations
  (idempotent — P3-1), then start the long-running daemon (P3-4).
- **Done:** `docker compose up -d` followed by `memory health`
  returns `status: ok` without manual intervention.

### P3-4 · Proper `memory serve` daemon (replace `tail -f`) [Could → 1.1.0]

- **Why:** Reviewer called the current `tail -f /dev/null` pattern
  "clever workaround, not final runtime story". A purpose-built
  daemon surface is cleaner and lets health checks probe real liveness.
- **Scope:** New `memory serve` subcommand that starts a no-op
  supervisor loop (or optional HTTP health endpoint — scope TBD in
  P3-4-spike). Update `docker-compose.yml` and `Dockerfile` to use it.
- **Done:** Container's `CMD` is `memory serve`; healthcheck hits
  a real liveness probe; no more `tail -f /dev/null`.

### P3-5 · README inconsistency fixes [Must]

- **Why:** README says `23 MCP tools` (Z.59, 225) but `17 tools`
  (Z.293). Says `14 CLI commands` (Z.235) but lists 12 names
  (Z.237-238). `240 tests passing` is hardcoded (Z.6). All confuse
  readers and undermine trust.
- **Scope:** Pick ground truth for each (MCP tool count via
  `src/mcp/tools/`; CLI command count via `src/cli/index.ts`;
  test count via `npm test` JSON reporter). Fix numbers. Remove the
  `17 tools` source-tree comment mismatch.
- **Done:** Every hardcoded count in README matches P0-4 inventory's
  source-of-truth command output; P6-2/P6-3 guards lock them.

### P3-6 · `MCP_PORT` vaporware cleanup [Must]

- **Why:** `docs/configuration.md:86` documents `MCP_PORT` for
  "future HTTP transport" that doesn't exist, isn't on any roadmap,
  and isn't reachable code. Vaporware erodes trust.
- **Scope:** Either (a) remove the variable from config docs and
  `src/config.ts` if unused, or (b) add a clear "NOT YET IMPLEMENTED
  — tracked as #xxx" with a real issue link. Decision in P0-2.
- **Done:** No documented config option advertises non-existent
  functionality without an explicit not-yet-implemented marker.

### P3-7 · `REPO_ROOT` + volume-mount path semantics [Must]

- **Why:** Docker sidecar mounts `.:/workspace:ro` but docs suggest
  setting `REPO_ROOT=/abs/host/path` (README Z.154, 172). Inside the
  container, the host path doesn't exist — validators would fail.
- **Scope:** Document the pattern: inside-container `REPO_ROOT` must
  be `/workspace` (the mount target); host-side usage sets the host
  path. Add a troubleshooting entry. Align all Docker examples.
- **Done:** No example has `REPO_ROOT=/host/...` inside a compose
  `environment:` block; troubleshooting covers the confusion.

---

## Phase 4 — Governance & Release Hygiene

Baseline for an open-source package tagged `1.0.0`. Everything docs-only,
fits patch release.

### P4-1 · `CHANGELOG.md` [Must]

- **Why:** Tag `1.0.0` exists without a changelog. Every downstream
  tool (Dependabot, Renovate, npm) expects one by convention.
- **Scope:** Keep-a-Changelog format. Retroactive `1.0.0` entry
  summarising PR #2 phases. `1.0.1 [Unreleased]` section populated
  as this roadmap progresses.
- **Done:** File present; linked from README; CI check verifies
  the version in `package.json` has a corresponding `CHANGELOG.md`
  section (added in P6-6).

### P4-2 · `CONTRIBUTING.md` [Should]

- **Why:** External contributors currently have no entry point
  beyond "read the code". Tag 1.0.0 is the moment to publish
  expectations.
- **Scope:** Dev setup recap (references README + AGENTS.md), test
  expectations, conventional-commits reminder, PR workflow, code
  style (Biome), how to run the full verification pipeline.
- **Done:** File exists; links from README + PR template (P4-4).

### P4-3 · `SECURITY.md` [Must]

- **Why:** Package handles DB credentials, ingests user code via the
  privacy filter, and exposes an MCP surface agents can write to.
  GitHub surfaces `SECURITY.md` in the "Security" tab for every repo.
- **Scope:** Disclosure policy (email), supported versions table,
  handling guarantees (privacy filter scope, what gets logged,
  what doesn't), non-guarantees.
- **Done:** File exists; GitHub "Security" tab shows green check.

### P4-4 · Issue + PR templates [Should]

- **Why:** Reduces triage cost; sets expectation for reporters.
- **Scope:** `.github/ISSUE_TEMPLATE/bug_report.yml`,
  `feature_request.yml`, `PULL_REQUEST_TEMPLATE.md`. Bug template
  asks for `memory doctor` JSON + version.
- **Done:** Templates visible on "New issue" and "New PR" flows;
  bug reports arrive with the required fields pre-filled.

### P4-5 · Repo metadata checklist [Must]

- **Why:** GitHub "About" box is empty (no description, no topics,
  no homepage). First impression before anyone opens README.
- **Scope:** Not a code task — this roadmap carries a checklist
  the user executes in repo settings: description (one line),
  topics (`mcp`, `agent-memory`, `postgres`, `pgvector`,
  `trust-scoring`, `ai-agents`, `llm-memory`, `typescript`),
  website (GitHub Pages later, or repo URL), security features
  enabled (Dependabot alerts, code scanning).
- **Done:** "About" box populated; topics set; Dependabot on.

---

## Phase 5 — `agent-config` Integration Story

Tell the companion story as **one** coherent narrative, not scattered
implications. Runs after Phase 1 — universality must be established
first so the integration reads as "these two can combine", not
"agent-memory is for agent-config users".

### P5-1 · `docs/integration-agent-config.md` [Should]

- **Why:** Currently `agent-config` is mentioned in AGENTS.md, Node
  guide, and CLI reference, but never explained as a product pairing.
- **Scope:** New doc. Sections: What each package does (two
  sentences), the division of labour (`agent-config` = behaviour;
  `agent-memory` = persistence), how they connect (retrieval contract
  v1 link), what you lose if you use only one, upgrade/compatibility
  notes. Symlink mechanics (`.augment/` hydration via postinstall).
- **Done:** Doc exists; README has a "With `agent-config`" subsection
  (one paragraph) that links here and ends the matter.

### P5-2 · `examples/with-agent-config/` reference setup [Should]

- **Why:** Consumer question after reading P5-1: "show me one
  working setup". No such example exists.
- **Scope:** Minimal compose + package.json that depends on both
  `agent-config` and `agent-memory`, runs the agent-config
  postinstall, boots the memory sidecar, verifies agents can resolve
  both `.augment/skills/` and `memory *` commands.
- **Done:** `docker compose up -d` followed by a scripted smoke
  test proves both pieces work together.

### P5-3 · Contract tests against `agent-config` [Could → 1.1.0]

- **Why:** The retrieval contract (`contract_version: 1`) is the
  only formal API between the packages. Today nothing prevents an
  accidental breaking change here.
- **Scope:** A CI job (triggered on push to `main` and weekly)
  that installs a pinned `agent-config` version in a fixture dir
  and asserts `health()`, `retrieve()`, `propose()`, `promote()`
  schemas match the v1 spec. Fails fast on breakage.
- **Done:** CI job green on `main`; intentional breakage fails
  visibly and can be unblocked only by a contract-version bump.

### P5-4 · `docs/compatibility-matrix.md` [Should]

- **Why:** Current README has one compatibility row. Long-term the
  matrix needs rows for multiple minor versions of both packages.
- **Scope:** Dedicated doc with a live matrix: `agent-memory`
  version × `agent-config` version × Node × Postgres × MCP SDK
  version. Include a "breaking change" column with dates.
- **Done:** Doc exists; P1-7 links to it; one entry per supported
  pairing.

---

## Phase 6 — Drift Prevention Extension

PR #2 established three guards (CLI docs, portability, links). This
phase extends the set to cover every new drift surface introduced
by Phases 0-5. All guards non-breaking for existing CI.

### P6-1 · Auto-inject test count into AGENTS.md / README [Could]

- **Why:** "240 tests passing" is hardcoded in two places and will
  drift the next time a test is added.
- **Scope:** Add a marker-bounded block, regenerated by a script
  from `npm test --reporter=json | jq '.numTotalTests'`. CI check
  fails if the committed count doesn't match fresh output.
- **Done:** Adding a test updates the badge via `npm run docs:stats`;
  stale counts fail CI.

### P6-2 · MCP tool-count guard [Should]

- **Why:** README's "23 MCP tools" has no mechanical source of truth.
- **Scope:** Script walks `src/mcp/server.ts` registration table,
  outputs count. CI fails if README mentions a different number.
  Marker pattern, same as P6-1.
- **Done:** Adding a new MCP tool bumps the README automatically
  or fails CI with a clear message.

### P6-3 · CLI command-count guard [Should]

- **Why:** Same as P6-2 for CLI.
- **Scope:** Script walks Commander `program.commands`, outputs
  count + names. Compared against README's "N CLI commands" line
  and the name list below it.
- **Done:** Adding a new CLI subcommand updates the README list
  automatically or fails CI.

### P6-4 · Universality guard extension [Should]

- **Why:** Existing `check:portability` catches Laravel terms in
  `AGENTS.md` and `copilot-instructions.md`. It does not cover the
  new neutral guides produced by Phase 1.
- **Scope:** Extend the portability scanner to also flag
  `docs/consumer-setup-generic.md`, `docs/consumer-setup-docker-sidecar.md`,
  `docs/comparisons.md`, `docs/glossary.md`, `docs/tutorial-first-memory.md`
  — these must remain stack-neutral.
- **Done:** Scanner treats neutral docs as strict; `examples/*` and
  `docs/consumer-setup-node.md` remain allow-listed for stack
  specifics.

### P6-5 · Glossary drift guard [Could]

- **Why:** `docs/glossary.md` (P2-2) will drift when new enums are
  added to `src/types.ts`.
- **Scope:** Script extracts enum + exported-type names from
  `src/types.ts` and checks each appears in `docs/glossary.md`.
  CI fails on uncovered terms.
- **Done:** Adding an enum value to `src/types.ts` without a
  glossary entry fails CI with a pointer to the missing term.

### P6-6 · CHANGELOG freshness guard [Should]

- **Why:** `CHANGELOG.md` (P4-1) needs a guard or it will lag
  behind `package.json` version.
- **Scope:** CI check that the `version` in `package.json` has a
  matching non-`[Unreleased]` section in `CHANGELOG.md`.
- **Done:** Bumping `package.json` without a CHANGELOG entry fails
  CI.

---

## Phase 7 — Release

### P7-1 · Tag `1.0.1` [Must]

- **Why:** Closes the 1.0.1 cycle.
- **Scope:** After all `[Must]` tasks are green and any `[Should]`
  tasks pulled into cycle are green. Full verification gate (lint,
  typecheck, tests, docs:cli:check, check:portability, check:links,
  P6-2..P6-6 if shipped) exits 0 on a fresh clone.
- **Done:** Tag on `main`; GitHub release notes drafted (P7-2).

### P7-2 · Release notes (`1.0.1`) [Must]

- **Why:** Every tag deserves notes, especially one correcting
  positioning on the heels of `1.0.0`.
- **Scope:** `CHANGELOG.md` entry + matching GitHub release text
  highlighting universality refactor, glossary, non-goals, governance
  docs. Explicitly flag breaking renames (P1-2, P1-4) even though
  they're docs.
- **Done:** Release text points readers at the new entry points;
  CHANGELOG in sync.

### P7-3 · Draft announcement [Could]

- **Why:** Optional public surface for the shift in positioning.
- **Scope:** Short GitHub Discussions post or similar channel.
  Link the new universal entry points.
- **Done:** Draft exists in `agents/drafts/` (not auto-published).

---

## Dependencies

```
P0  blocks  P1, P2, P3, P6
P1  blocks  P5 (universal positioning before companion story)
P3-1 blocks P3-3 (auto-migrate needs migrate subcommand)
P3-4 blocks P3-3 (auto-migrate needs daemon target)
P2-2 blocks P6-5 (guard needs glossary to guard against)
P4-1 blocks P6-6 (guard needs CHANGELOG to guard)
P2-* parallel to P4-*
P6-2..P6-6 parallel to P3-5..P3-7
P7-1 blocked by all Must tasks of P1, P2, P3 (fix-scale), P4
```

## Out of scope (for this roadmap)

- HTTP transport for the MCP server (covered superficially in P3-6;
  real implementation is a separate roadmap).
- Embedding-provider improvements beyond the existing factory chain.
- New memory types or trust-score algorithm changes.
- `npm publish` governance — tracked separately as a release-process
  decision.
- Anything under `.augment/` (vendored from `agent-config`) — those
  changes go through the `agent-config` repo and propagate here via
  postinstall.

## Cycle summary

- **1.0.1** (this cycle):
  All 22 `[Must]` tasks (P0-1..4, P1-1..4, P1-6..8, P2-1, P2-2, P2-4,
  P3-5, P3-6, P3-7, P4-1, P4-3, P4-5, P7-1, P7-2).
  Plus `[Should]` tasks pulled into cycle as capacity allows:
  P1-5, P2-3, P2-5, P4-2, P4-4, P5-1, P5-2, P5-4, P6-2..P6-4, P6-6.
- **1.1.0** (follow-up):
  P3-1, P3-2, P3-3, P3-4 (feature-scale tasks), P5-3, P6-1, P6-5, P7-3.

## Completion checklist

- [ ] All `[Must]` tasks checked off.
- [ ] All verification gates exit 0 on a fresh clone.
- [ ] `CHANGELOG.md` updated with every shipped task.
- [ ] Tag `1.0.1` pushed; release notes published.
- [ ] This file archived to `agents/roadmaps/archive/improve-system.md`
      on completion.

