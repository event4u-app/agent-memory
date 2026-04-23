# Roadmap — improve-system

**Branch:** `feat/improve-system`
**Release target:** `1.1.0` (minor) — universality refactor, concept
clarity, governance hygiene, **plus** first-run DX features (new CLI
subcommands, auto-migrate, programmatic exports) and the retrieval
contract-test harness. Promoted from `1.0.1` after external review:
the Must-list includes new public API surface, which requires a minor
bump per semver.
**Rename policy:** hard renames, no redirect stubs — tag `1.0.0` is
days old and no external links to the renamed paths are in the wild.
The rename mapping is documented in the `1.1.0` release notes (P7-2).

## Goal

Lift `@event4u/agent-memory` from "V1 complete, Node+PHP/Laravel-biased"
to **universal, polished, production-grade** — stack-agnostic
positioning, concept clarity, first-run DX without manual migration
steps, a locked retrieval contract, governance hygiene, and
drift-prevention extended to the new surface area.

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
5. **Contract stability over feature growth.** The retrieval contract
   (`contract_version: 1`) is the only formal API into this package.
   It gets schema-fixture tests before any 1.1.x adds to it.

## Priority legend

- **[Must]** — blocks the `1.1.0` release. Without these, no tag.
- **[Should]** — in the `1.1.0` cycle if time allows, otherwise the
  first thing to pull into `1.1.x`.
- **[Could]** — deferred to `1.1.x` or `1.2` by design. Polish that
  adds value but isn't gating.

Nothing gets dropped. Priority controls **sequence and release
pinning**, not scope.

## Phase overview

| Phase | Theme                                  | Tasks | Cycle   |
|-------|----------------------------------------|-------|---------|
| P0    | Audit & baseline                       |   4   | 1.1.0   |
| P1    | Universality refactor (core directive) |   8   | 1.1.0   |
| P2    | Reviewer gaps & concept clarity        |   8   | 1.1.0   |
| P3    | Technical smoothing (first-run & DX)   |   9   | 1.1.0   |
| P4    | Governance & release hygiene           |   5   | 1.1.0   |
| P5    | `agent-config` integration story       |   4   | 1.1.0   |
| P6    | Drift-prevention extension             |   6   | 1.1.0   |
| P7    | Release                                |   3   | 1.1.0   |

Total: **47 tasks**. Of these, **34 are [Must]**, blocking the 1.1.0
tag; **9 [Should]** pulled in as capacity allows; **4 [Could]** deferred
to 1.1.x or 1.2 without penalty.

### Redundancy & deduplication notes

- **P0-3 (concept inventory) feeds P2-2 (glossary) directly.** No
  separate `docs/concept-inventory.md` artifact ships — the inventory
  lives inline in `agents/analysis/improve-system-phase0.md` and all
  definitions land in `docs/glossary.md`. Flagged as a dedup win during
  review; recorded here so future contributors don't recreate the
  redundant file.

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

### P2-6 · README embeddings section [Must]

- **Why:** First reviewer cycle flagged "embeddings unexplained" as a
  false positive because the info is in `docs/configuration.md`. But
  the README never surfaces **which** providers are supported or how
  to pick one. Visibility, not new docs.
- **Scope:** 15-20 line section under "How it works": supported
  providers (`openai`, `cohere`, `local`, `bm25-only` fallback),
  default behaviour (bm25-only when no provider configured), link to
  `docs/configuration.md` for the full env matrix.
- **Done:** README reader can answer "does this need OpenAI?" without
  leaving the README. No new doc files created.

### P2-7 · README environment section [Must]

- **Why:** Same pattern as P2-6 — `.env.example` exists, but the README
  quick-start assumes it without naming the variables that matter most
  (`DATABASE_URL`, `REPO_ROOT`, `MEMORY_TRUST_THRESHOLD_DEFAULT`,
  `EMBEDDING_PROVIDER`).
- **Scope:** Compact "Environment" subsection under Quick Start —
  the 4-5 variables a user touches in week one, with defaults and
  one-line purpose. Link to full `docs/configuration.md` for the rest.
- **Done:** README has an Environment block; AGENTS.md's env table
  already in place stays as the agent-facing mirror.

### P2-8 · Embedding cost / privacy disclosure [Could]

- **Why:** Consumers picking `openai` as embedding provider need to
  know that snippets of ingested code are sent to the provider. The
  privacy filter reduces but does not eliminate this.
- **Scope:** One short subsection in `docs/configuration.md` under
  `EMBEDDING_PROVIDER` covering: what leaves the network, approximate
  cost per 1000 entries for each provider, how to stay local with
  `bm25-only` or `local`.
- **Done:** Any operator can, in 30 s, understand the privacy
  implications of picking a cloud embedding provider.

---

## Phase 3 — Technical Smoothing (First-Run & DX)

Full 1.1.0 cycle. The semver bump to minor unlocks the migrate /
auto-migrate / serve tasks that were parked as `1.1.0`-pending in
the prior draft.

### P3-1 · New `memory migrate` CLI subcommand [Must]

- **Why:** `docs/consumer-setup-node.md` currently tells consumers to
  run `node node_modules/@event4u/agent-memory/dist/db/migrate.js` —
  an internal path. Breaks on package reorganisation.
- **Scope:** New Commander subcommand `memory migrate` that invokes
  the existing migration runner. JSON on stdout, exit code 0/1.
  Idempotent. Update Node guide `§5` and `consumer-setup-docker-sidecar.md`
  to use it.
- **Done:** `memory migrate` works from Docker sidecar and npm
  install; no guide references internal `dist/` paths any more;
  P6-3 CLI-count guard updated.

### P3-2 · Programmatic `runMigrations()` export [Must]

- **Why:** Node-guide §5 states "A stable `runMigrations`
  programmatic export is tracked for v0.2." — 1.1.0 makes good on that.
- **Scope:** Export `runMigrations(opts?: { databaseUrl?: string })`
  from package root. Idempotent, returns applied migration list.
  Thin wrapper calling the same code as P3-1's CLI.
- **Done:** Import works from a fresh consumer install; tests cover
  idempotence, custom `databaseUrl`, and error paths.

### P3-3 · Container auto-migrate on first start [Must]

- **Why:** Current container runs `tail -f /dev/null` and ships an
  empty DB until someone `docker compose exec`s migrate manually.
  First-run UX: user runs `memory health`, gets "migrations pending".
- **Scope:** Entrypoint script: wait for Postgres (bounded timeout),
  run migrations (idempotent — via P3-1/P3-2), then start the
  long-running process (P3-4a target). Opt-out via
  `MEMORY_AUTO_MIGRATE=false` for operators who want to gate
  migrations themselves.
- **Done:** `docker compose up -d` followed by `memory health`
  returns `status: ok` without manual intervention; opt-out
  documented in `docs/configuration.md`.

### P3-4a · `memory serve` ADR [Must]

- **Why:** Before implementing a daemon, decide the shape:
  supervisor loop only, or supervisor + liveness/readiness HTTP
  endpoint? Different implications for container orchestration,
  healthchecks, and future HTTP-transport ambitions.
- **Scope:** New ADR `agents/adrs/0002-memory-serve-surface.md`
  covering options, trade-offs, decision, and migration path from
  `tail -f /dev/null`. Referenced by P3-4b.
- **Done:** ADR merged; P3-4b can be scheduled with a clear
  implementation target.

### P3-4b · Implement `memory serve` (replace `tail -f`) [Should]

- **Why:** Execute the P3-4a decision. Reviewer called the current
  `tail -f /dev/null` pattern "clever workaround, not final runtime
  story".
- **Scope:** Per P3-4a: new `memory serve` subcommand, updated
  `docker-compose.yml` + `Dockerfile` so container `CMD` is
  `memory serve`, healthcheck hits the real probe. If P3-4a decides
  on HTTP surface, add `MEMORY_SERVE_PORT` env + document.
- **Done:** Container `CMD` is `memory serve`; healthcheck uses the
  real probe; no more `tail -f /dev/null` anywhere in repo.

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

### P3-8 · Third-party cold-start verification [Must]

- **Why:** Before tagging 1.1.0, verify a consumer who never worked on
  this repo can go from "empty directory" to "first retrieve call"
  using **only** the public guides. Gate before P7-1 — catches every
  assumption baked into the docs that works only because the maintainer
  has the repo cloned.
- **Scope:** Run the generic and Docker-sidecar guides from a fresh
  directory with **no access to the repo**: pull the (unreleased)
  image, follow `docs/consumer-setup-generic.md` step by step, record
  every friction point. Fix each; re-run until clean. Capture the
  transcript under `agents/analysis/cold-start-transcript.md`.
- **Done:** A second, independent cold-start run (by user or
  reviewer) completes without referring to the repo source; transcript
  archived.
- **Status (2026-04-23):** First cold-start pass complete against a
  locally-built image in `/tmp/agent-memory-cold-start`. Three blocker
  bugs found and fixed on `feat/improve-system` — (1) symlink-aware
  `isMainModule` helper (CLI/migrate/MCP entry detection failed under
  `/usr/local/bin/memory` symlink); (2) `memory serve` event-loop
  keep-alive (`setInterval` so Node doesn't exit on unsettled top-level
  await); (3) stale compose `command:` override caught during P3-7.
  Transcript: `agents/analysis/cold-start-transcript.md`. Remaining
  exit criterion: second independent run by reviewer post-merge.

---

## Phase 4 — Governance & Release Hygiene

Baseline for an open-source package tagged `1.0.0`. Everything docs-only,
fits the 1.1.0 cycle.

### P4-1 · `CHANGELOG.md` [Must]

- **Why:** Tag `1.0.0` exists without a changelog. Every downstream
  tool (Dependabot, Renovate, npm) expects one by convention.
- **Scope:** Keep-a-Changelog format. Retroactive `1.0.0` entry
  summarising PR #2 phases. `1.1.0 [Unreleased]` section populated
  as this roadmap progresses; **must explicitly list the rename
  mapping** (P1-2, P1-4) under a "Renamed" subsection so external
  consumers can find the new paths.
- **Done:** File present; linked from README; rename mapping listed;
  CI check verifies the version in `package.json` has a corresponding
  `CHANGELOG.md` section (added in P6-6).
- **Status (2026-04-23):** `CHANGELOG.md` shipped on
  `feat/improve-system` (Keep-a-Changelog 1.1.0 format). Retroactive
  `[1.0.0]` entry covers PR #2 phases; `[Unreleased] — 1.1.0` section
  lists everything from Phase 0-3 + explicit "Renamed" subsection
  with P1-2 and P1-4 mappings. Linked from README §Changelog. CI
  version/CHANGELOG sync check remains open (P6-6).

### P4-2 · `CONTRIBUTING.md` [Should]

- **Why:** External contributors currently have no entry point
  beyond "read the code". Tag 1.0.0 is the moment to publish
  expectations.
- **Scope:** Dev setup recap (references README + AGENTS.md), test
  expectations, conventional-commits reminder, PR workflow, code
  style (Biome), how to run the full verification pipeline.
- **Done:** File exists; links from README + PR template (P4-4).
- **Status (2026-04-23):** Shipped. `CONTRIBUTING.md` references
  README + AGENTS.md for dev setup, documents the full six-command
  verification pipeline, Conventional Commits format, PR workflow,
  and scope/privacy expectations. README §Contributing links it.

### P4-3 · `SECURITY.md` [Must]

- **Why:** Package handles DB credentials, ingests user code via the
  privacy filter, and exposes an MCP surface agents can write to.
  GitHub surfaces `SECURITY.md` in the "Security" tab for every repo.
- **Scope:** Disclosure policy (email), supported versions table,
  handling guarantees (privacy filter scope, what gets logged,
  what doesn't), non-guarantees.
- **Done:** File exists; GitHub "Security" tab shows green check.
- **Status (2026-04-23):** Shipped. Uses GitHub private vulnerability
  reporting as the primary channel (modern best practice) with a
  fallback public-issue pattern. Supported versions table covers
  `1.1.x`, `1.0.x`, `0.x`. Handling guarantees enumerate privacy
  filter coverage, log redaction (`DATABASE_URL` masking), quarantine
  and access-scope behaviour. Reporter safe-harbour clause included.

### P4-4 · Issue + PR templates [Should]

- **Why:** Reduces triage cost; sets expectation for reporters.
- **Scope:** `.github/ISSUE_TEMPLATE/bug_report.yml`,
  `feature_request.yml`, `PULL_REQUEST_TEMPLATE.md`. Bug template
  asks for `memory doctor` JSON + version.
- **Done:** Templates visible on "New issue" and "New PR" flows;
  bug reports arrive with the required fields pre-filled.
- **Status (2026-04-23):** Shipped. Three files under
  `.github/ISSUE_TEMPLATE/` (`bug_report.yml`, `feature_request.yml`,
  `config.yml` routing security → advisories, questions → discussions)
  plus `.github/PULL_REQUEST_TEMPLATE.md`. Bug report enforces
  `memory doctor` JSON + package version via `validations.required`.
  PR template requires the six-check verification pipeline, changelog
  line, and security-consideration note.

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
- **Status (2026-04-23):** Shipped. `docs/integration-agent-config.md`
  covers what each package does, the division-of-labour diagram,
  `postinstall` hydration mechanics, retrieval contract v1 surfaces
  (with links to every schema), what you lose by using only one
  package, and upgrade notes. README's "Optional companion" section
  links here and to `examples/with-agent-config/`.

### P5-2 · `examples/with-agent-config/` reference setup [Should]

- **Why:** Consumer question after reading P5-1: "show me one
  working setup". No such example exists.
- **Scope:** Minimal compose + package.json that depends on both
  `agent-config` and `agent-memory`, runs the agent-config
  postinstall, boots the memory sidecar, verifies agents can resolve
  both `.augment/skills/` and `memory *` commands.
- **Done:** `docker compose up -d` followed by a scripted smoke
  test proves both pieces work together.
- **Status (2026-04-23):** Shipped. New directory with
  `package.json` (depends on both packages via github: specs),
  `docker-compose.yml` (postgres + published image), `.env.example`,
  and `smoke-test.sh` — asserts `.augment/skills/` has at least one
  `SKILL.md` symlink (agent-config hydration worked), the
  `agent-memory` container responds to `memory health` with
  `status: ok | degraded`, and the response carries
  `contract_version: 1`. Linked from `examples/README.md` and the
  README's Optional-companion section.

### P5-3 · Retrieval contract schema fixtures [Must]

- **Why:** The retrieval contract (`contract_version: 1`) is the only
  formal API into this package. Without a fixture-based test, any
  structural change (field rename, type narrowing, nullability flip)
  can ship accidentally. Blocks 1.1.0 because 1.1.0 adds new CLI
  surface — we lock the existing shape before expanding it.
- **Scope (kept minimal):** Commit golden JSON fixtures for `health()`,
  `retrieve()`, `propose()`, `promote()`, `deprecate()` v1 responses
  into `tests/contract/fixtures/`. One Vitest suite compares live
  output shape (keys + types, not values) against each fixture. No
  pinned `agent-config` install — that broader consumer-side job can
  come in 1.1.x as P5-3-extension. This task only protects our own
  output shape.
- **Done:** `npm run test:contract` exists; CI runs it on every push;
  intentional shape change requires either a fixture update (additive)
  or a `contract_version` bump (breaking). Documented in
  `agents/adrs/0003-contract-version-bumps.md` (new).
- **Status (2026-04-23):** Shipped. Three new JSON schemas
  (`propose-v1`, `promote-v1`, `deprecate-v1`) alongside the existing
  `retrieval-v1` / `health-v1` schemas. Five new golden fixtures
  (`golden-propose`, `golden-promote-validated`,
  `golden-promote-rejected`, `golden-deprecate`,
  `golden-deprecate-with-successor`). New test file
  `tests/contract/promotion-contract.test.ts` adds 16 tests that
  validate fixtures against schemas AND assert the live TypeScript
  types (`ProposeResult`, `PromoteResult`, `DeprecateResult`) from
  `src/trust/promotion.service.ts` conform — catches drift at
  typecheck + runtime. `npm run test:contract` added; existing CI
  `npm test` already covers it. ADR-0003 documents additive vs.
  breaking policy and the deprecation window.

### P5-4 · `docs/compatibility-matrix.md` [Should]

- **Why:** Current README has one compatibility row. Long-term the
  matrix needs rows for multiple minor versions of both packages.
- **Scope:** Dedicated doc with a live matrix: `agent-memory`
  version × `agent-config` version × Node × Postgres × MCP SDK
  version. Include a "breaking change" column with dates.
- **Done:** Doc exists; P1-7 links to it; one entry per supported
  pairing.
- **Status (2026-04-23):** Shipped. `docs/compatibility-matrix.md`
  carries three tables (runtime requirements, contract versions,
  companion pairings) plus a per-axis breaking-change log and
  upgrade-notes section per release step. Linked from the top-level
  README Compatibility section and from `examples/README.md`.

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

### P6-2 · MCP tool-count guard [Must]

- **Why:** README's "23 MCP tools" has no mechanical source of truth.
- **Scope:** Script walks `src/mcp/server.ts` registration table,
  outputs count. CI fails if README mentions a different number.
  Marker pattern, same as P6-1.
- **Done:** Adding a new MCP tool bumps the README automatically
  or fails CI with a clear message.
- **Status (2026-04-23):** Shipped. `scripts/check-mcp-tools.ts`
  imports `TOOL_DEFINITIONS` from `src/mcp/tool-definitions.ts`,
  parses the README `### MCP tools (N)` heading plus the backtick
  tool names in the table below, and fails on count drift, missing
  entries, or stray entries. Wired into `npm run check:mcp-tools`
  and the `docs-checks.yml` workflow.

### P6-3 · CLI command-count guard [Must]

- **Why:** Same as P6-2 for CLI.
- **Scope:** Script walks Commander `program.commands`, outputs
  count + names. Compared against README's "N CLI commands" line
  and the name list below it.
- **Done:** Adding a new CLI subcommand updates the README list
  automatically or fails CI.
- **Status (2026-04-23):** Shipped. `scripts/check-cli-commands.ts`
  reads `program.commands` from `src/cli/index.ts` and compares
  against README's `### CLI commands (N)` heading + the backtick
  list. Wired into `npm run check:cli-commands` and
  `docs-checks.yml`.

### P6-4 · Universality guard extension [Must]

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
- **Status (2026-04-23):** Shipped with scope refinement.
  `scripts/check-neutral-docs.ts` strict-scans the three
  pure-knowledge docs (`comparisons.md`, `glossary.md`,
  `tutorial-first-memory.md`) for any stack-specific term (Laravel,
  Django, Rails, Spring Boot, composer, pip install, etc.). Skips
  fenced code blocks. The two multi-stack setup guides
  (`consumer-setup-generic.md`, `consumer-setup-docker-sidecar.md`)
  are explicitly *not* in the strict list — they are multi-stack
  showcases with parallel code blocks that name stacks equivalently
  by design. They remain covered by the broader repo-wide
  `check:portability` scanner. Wired into `npm run check:neutral-docs`
  and `docs-checks.yml`. Missing targets (`comparisons.md`,
  `tutorial-first-memory.md` — P2-3 and P2-5 are Should, not yet
  shipped) are treated as no-op rather than a failure.

### P6-5 · Glossary drift guard [Could]

- **Why:** `docs/glossary.md` (P2-2) will drift when new enums are
  added to `src/types.ts`.
- **Scope:** Script extracts enum + exported-type names from
  `src/types.ts` and checks each appears in `docs/glossary.md`.
  CI fails on uncovered terms.
- **Done:** Adding an enum value to `src/types.ts` without a
  glossary entry fails CI with a pointer to the missing term.

### P6-6 · CHANGELOG freshness guard [Must]

- **Why:** `CHANGELOG.md` (P4-1) needs a guard or it will lag
  behind `package.json` version.
- **Scope:** CI check that the `version` in `package.json` has a
  matching non-`[Unreleased]` section in `CHANGELOG.md`.
- **Done:** Bumping `package.json` without a CHANGELOG entry fails
  CI.
- **Status (2026-04-23):** Shipped. `scripts/check-changelog.ts`
  reads `package.json` version and asserts `## [X.Y.Z]` exists in
  `CHANGELOG.md`. `0.1.0` is whitelisted as the historical baseline
  (CHANGELOG introduction postdated it; documented in the 1.0.0
  section). Wired into `npm run check:changelog` and
  `docs-checks.yml`. Will start enforcing when P7-1 bumps the
  version to 1.1.0.

---

## Phase 7 — Release

### P7-1 · Tag `1.1.0` [Must]

- **Why:** Closes the 1.1.0 cycle.
- **Scope:** After all `[Must]` tasks are green and any `[Should]`
  tasks pulled into cycle are green. Full verification gate (lint,
  typecheck, tests, `test:contract`, docs:cli:check, check:portability,
  check:links, P6-2..P6-6) exits 0 on a fresh clone. P3-8 cold-start
  transcript attached.
- **Done:** Tag on `main`; GitHub release notes drafted (P7-2);
  `package.json` version bumped to `1.1.0`.

### P7-2 · Release notes (`1.1.0`) [Must]

- **Why:** Every minor bump deserves notes, especially one correcting
  positioning and adding new public API surface.
- **Scope:** `CHANGELOG.md` entry + matching GitHub release text in
  three sections:
  - **Added** — `memory migrate`, `memory serve`, `runMigrations()`
    export, auto-migrate on container start, retrieval contract
    fixtures, README embeddings/environment sections, glossary,
    comparisons, non-goals.
  - **Changed** — universality refactor (README/AGENTS.md), compat
    matrix shape, `REPO_ROOT` container semantics.
  - **Renamed** — explicit mapping: `docs/consumer-setup-php.md` →
    `docs/consumer-setup-docker-sidecar.md`, `examples/php-laravel-sidecar/`
    → `examples/laravel-sidecar/`. No redirects.
- **Done:** Release text points readers at the new entry points;
  CHANGELOG in sync; rename mapping visible to anyone hitting a
  stale external link.
- **Status (2026-04-23):** Shipped. `CHANGELOG.md` `[Unreleased] —
  1.1.0` section carries Added / Changed / Fixed / Renamed, test
  count updated to 267, drift-guard surface documented, `REPO_ROOT`
  clarification added. Draft GitHub release text parked at
  `agents/drafts/release-notes-1.1.0.md` — paste-ready when P7-1
  pushes the tag; mirrors the CHANGELOG one-to-one with the rename
  mapping surfaced in its own table.

### P7-3 · Draft announcement [Could]

- **Why:** Optional public surface for the shift in positioning +
  feature expansion.
- **Scope:** Short GitHub Discussions post or similar channel.
  Link the new universal entry points and the new CLI surface.
- **Done:** Draft exists in `agents/drafts/` (not auto-published).

---

## Dependencies

```
P0  blocks  P1, P2, P3, P6
P1  blocks  P5 (universal positioning before companion story)
P3-1 blocks P3-2, P3-3 (programmatic + auto-migrate reuse the runner)
P3-4a blocks P3-4b (ADR decides implementation shape)
P3-3 blocks P3-8 (cold-start needs auto-migrate working)
P2-2 blocks P6-5 (guard needs glossary to guard against)
P4-1 blocks P6-6 (guard needs CHANGELOG to guard)
P5-3 blocks P7-1 (no 1.1.0 tag without locked contract fixtures)
P3-8 blocks P7-1 (no tag until cold-start verifies from zero)
P2-* parallel to P4-*
P6-2..P6-6 parallel to P3-5..P3-7
P7-1 blocked by all Must tasks of P1-P6
```

## Out of scope (for this roadmap)

- HTTP transport for the MCP server (covered superficially in P3-6;
  P3-4a ADR may explicitly defer or scope-cap it; real implementation
  is a separate roadmap).
- Embedding-provider improvements beyond the existing factory chain.
- New memory types or trust-score algorithm changes.
- `npm publish` governance — tracked separately as a release-process
  decision.
- Anything under `.augment/` (vendored from `agent-config`) — those
  changes go through the `agent-config` repo and propagate here via
  postinstall.
- Pinned `agent-config` consumer-side contract job (deferred to
  1.1.x as P5-3-extension; 1.1.0 only locks our output shape).

## Cycle summary

- **1.1.0** (this cycle) — **34 `[Must]` tasks**, all blocking the tag:
  - **P0:** 0-1, 0-2, 0-3, 0-4
  - **P1:** 1-1, 1-2, 1-3, 1-4, 1-6, 1-7, 1-8
  - **P2:** 2-1, 2-2, 2-4, 2-6, 2-7
  - **P3:** 3-1, 3-2, 3-3, 3-4a, 3-5, 3-6, 3-7, 3-8
  - **P4:** 4-1, 4-3, 4-5
  - **P5:** 5-3
  - **P6:** 6-2, 6-3, 6-4, 6-6
  - **P7:** 7-1, 7-2
  - *(Tally: P0=4 + P1=7 + P2=5 + P3=8 + P4=3 + P5=1 + P6=4 + P7=2 = 34. Thirteen of these Must items were upgraded from Should/Could after the Option-C promotion — see the audit trail below.)*
- **`[Should]` tasks** pulled in as capacity allows:
  P1-5, P2-3, P2-5, P3-4b, P4-2, P4-4, P5-1, P5-2, P5-4.
- **`[Could]` tasks** — deferred without penalty:
  P2-8, P6-1, P6-5, P7-3.

### Roadmap audit trail (Option C: 1.1.0 promotion)

After the second review cycle the following priority shifts happened.
This trail exists so future readers understand why the Must-list is
larger than a typical patch-release roadmap.

| Task | Before | After | Reason |
|---|---|---|---|
| P2-6 | (new) | Must | Reviewer-flagged README visibility gap |
| P2-7 | (new) | Must | Same pattern; surface `.env.example` key vars |
| P2-8 | (new) | Could | Privacy/cost disclosure, valuable but not gating |
| P3-1 | Could → 1.1.0 | Must | 1.1.0 now current cycle; migrate blocks DX story |
| P3-2 | Could → 1.1.0 | Must | Pairs with P3-1 |
| P3-3 | Could → 1.1.0 | Must | First-run wow factor; needs P3-1 |
| P3-4 | Could → 1.1.0 | Split (P3-4a Must, P3-4b Should) | Decision first, implementation can slip |
| P3-8 | (new) | Must | Cold-start gate before tag |
| P5-3 | Could → 1.1.0 | Must | Contract lock before adding new CLI |
| P6-2 | Should | Must | P3-1 adds CLI — guard must ship with it |
| P6-3 | Should | Must | Same as P6-2 |
| P6-4 | Should | Must | New neutral docs need the strict lint |
| P6-6 | Should | Must | CHANGELOG (P4-1) is Must — its guard must be too |

## Completion checklist

- [ ] All `[Must]` tasks checked off.
- [ ] All verification gates exit 0 on a fresh clone.
- [ ] `CHANGELOG.md` updated with every shipped task, rename mapping
      included.
- [ ] `npm run test:contract` green on `main`.
- [x] P3-8 cold-start transcript archived (first pass; needs independent second run).
- [ ] `package.json` version bumped to `1.1.0`.
- [ ] Tag `1.1.0` pushed; release notes published.
- [ ] This file archived to `agents/roadmaps/archive/improve-system.md`
      on completion.

