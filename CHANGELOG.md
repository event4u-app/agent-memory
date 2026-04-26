# Changelog

All notable changes to `@event4u/agent-memory` are documented in this file.

The format is based on [Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning 2.0.0](https://semver.org/spec/v2.0.0.html).

Version tracking note: the Git tag `1.0.0` was created before `package.json`
was bumped — the baseline package version on tag `1.0.0` is `0.1.0`. The
`1.1.0` release (see below) brings `package.json` in line with the Git tag.

## [Unreleased]

Theme: **runtime reliability, visible trust layer, team adoption, ecosystem
lock-in, and a hard secret boundary**. Driven by two roadmaps on branch
`feat/improve-user-setup`, both archived on merge:

- `agents/roadmaps/archive/runtime-trust.md` — phases A (Runtime
  Excellence), B (Trust as a Feature), C (Team Adoption), D (Ecosystem
  Lock-In).
- `agents/roadmaps/archive/secret-safety.md` — phases I (policy &
  ingress), II (entropy + allow-list), III (egress filters & legacy
  scan), IV (audit + drift guards).

### Added

- `memory serve` exposes HTTP `/health` and `/ready` endpoints —
  liveness + readiness probes for the Docker sidecar (A1 ·
  runtime-trust).
- `memory migrate up` / `memory migrate status` subcommands — explicit
  control over migration execution, separate from `memory serve`'s
  auto-run (A1).
- `memory init` bootstrap command — generates `.agent-memory.yml` and
  validates the local Postgres + pgvector setup in a single step (A1).
- `memory doctor --fix` — auto-repairs missing `pgvector` extension
  and runs pending migrations end-to-end (A1).
- Prometheus metrics + SLO surface (`/metrics` on the supervisor port,
  RED-style histograms for retrieve/propose/promote, error budgets
  in `docs/observability.md`) (A2).
- `memory mcp` HTTP/SSE transport with bearer-token auth — second
  transport alongside stdio, single-tenant by design (A4). **BREAKING
  CHANGE** at the transport layer: stdio behaviour unchanged; new
  surface is opt-in via `--transport http`.
- Audit-log schema + repository emitter — every trust-transition
  records `before / after / reason` to `memory_events` (B4).
- `memory explain <id>` — score breakdown (BM25, vector, RRF, recency,
  trust) for any retrieval result (B1).
- `memory history <id>` — forensic timeline of trust transitions for
  a single entry (B2).
- `memory review` — weekly maintenance digest with contradiction
  detection (B3).
- `.agent-memory.yml` project config + `memory policy check` — gate
  CI on trust-floor and ingress policy violations (C1, C2).
- PR-integration envelope + weekly-digest example workflow — surfaces
  trust changes on every PR and posts a weekly summary to a chosen
  channel (C3, C4).
- `memory export` / `memory import` (JSONL with `export-v1.schema.json`
  + Ajv validation) — full data-portability with redaction on export
  and `verifyNoSecretLeak()` on both sides (D1).
- Five integration snippets, each with an executable `smoke.sh` and
  smoke-tested in CI (D2): `examples/integrations/claude-desktop`,
  `cursor`, `github-actions`, `docker-sidecar-laravel`,
  `docker-sidecar-django`.
- `memory import --from mem0-jsonl` — golden-fixture-tested mapper
  with provenance (`promotion_metadata.imported_from = "mem0"`,
  `mem0_id`, `mem0_raw`); same Ajv + secret-leak pass as native
  imports; default trust below retrieval threshold (D4).
- `event4u-app/with-agent-memory` reference repository — minimal
  Docker Compose + `smoke.sh` + weekly drift CI against
  `ghcr.io/event4u-app/agent-memory:main` (D3, external repo).
- `docs/deprecation-policy.md` operational playbook + drift-guard
  `scripts/check-deprecation-changelog.ts` (D5).
- Secret-safety primitives: `SecretViolation`, policy resolution, and
  ingress enforcement at CLI, MCP, and service boundaries — every
  ingress path now consults the same policy engine (secret-safety
  Phase I).
- Logger scrubs secrets from output, including deep-scrub for
  structured fields (`feat(security): scrub secrets from logger
  output`, plus deep-scrub fix; secret-safety I).
- Embedding ingress gated by the secret boundary — no secret ever
  reaches the embedding provider (secret-safety I).
- Versioned secret-pattern catalog with generated table + CI
  drift-guard (`scripts/generate-secret-patterns-doc.ts`) — the
  catalog is the single source of truth, README is regenerated
  (secret-safety II1).
- Calibrated entropy threshold against a fixture corpus + drift-guard
  on the calibration output — entropy floor is now reproducible, not
  hand-tuned (secret-safety II2, II3).
- High-entropy allow-list for benign shapes (UUIDs, hashes, base64
  metadata) — reduces false positives without weakening the floor
  (secret-safety II4).
- Retrieval output filter (`III2`) — secrets never leave the API
  surface, even if a legacy entry slipped past ingress.
- DB legacy-secret scan (`III1`) — scheduled re-scan over the
  existing entry corpus with quarantine on hit.
- Provider-boundary drift guard (`III4`) and ingress-path inventory
  drift guard (`IV4`) — fails CI if a new ingress path bypasses the
  secret boundary or a new provider call lacks the boundary check.
- `no-secret-in-output` contract matrix (`IV3`) — golden assertions
  across every public response shape.
- `memory doctor` secret-safety posture (`IV2`) — visible signal in
  doctor output for missing or stale guards.
- `memory_events` audit table for every secret reject/redact (`IV1`).
- Database migration `005_repair_jsonb_strings` — idempotent repair
  of double-encoded JSONB rows from earlier writes; safe to re-run.

### Changed

- CLI module layout: 928-line `src/cli/index.ts` monolith split into
  per-command modules under `src/cli/commands/` (A3). **BREAKING
  CHANGE** for downstream importers reaching into the CLI internals;
  the public `bin` entrypoint and command surface are unchanged.
- README quick-start now leads with the public reference repo
  (`event4u-app/with-agent-memory`) — single forward-reference, in
  the 60-second quick-start section.
- Install guidance: `agent-memory` is documented as a **dev
  dependency** by default; production sidecar setup remains via the
  Docker image (out-of-band of `npm install`).
- Documentation index: integrations status table (`docs/integrations/`)
  is now the source of truth for snippet maturity, replacing
  scattered hints in the README.

### Fixed

- JSONB columns (`scope`, `promotion_metadata` on memory entries and
  events) are now bound via `sql.json(obj)` instead of
  `${JSON.stringify(obj)}::jsonb` — `postgres.js` was double-encoding
  the JSON when it saw the cast on a string. Migration 005 repairs
  any rows written with the old code path. Regression coverage in
  `tests/integration/jsonb-encoding.integration.test.ts` (gated on
  `TEST_DATABASE_URL`).
- `memory doctor` `EXPECTED_MIGRATIONS` resynced with migration 004
  (B4 audit table) — drift between code and registered migrations no
  longer surfaces as a doctor warning on a fresh install.
- Secret-pattern description for `basic_auth_url` no longer breaks
  YAML/Markdown rendering — URL shape escaped at generation time
  (secret-safety II2 follow-up).
- `memory_observe` MCP ingress is now reject-by-default for unknown
  payload shapes — closes the gap in secret-safety II3.

### Tooling / CI

- `npm run check:portability` — guards the JSONL export schema and
  the foreign-identifier policy.
- `npm run check:deprecation-changelog` — guards deprecation entries
  against the playbook (D5).
- `npm run check:embedding-boundary` — drift-guard on the embedding
  provider boundary; fails CI if a provider call lacks the secret
  boundary check (secret-safety III4).
- `npm run check:ingress-guards` — drift-guard on the ingress-path
  inventory; fails CI on a new ingress path without secret-boundary
  wiring (secret-safety IV4).
- `scripts/generate-secret-patterns-doc.ts` — regenerates the
  secret-pattern catalogue table from the source-of-truth registry;
  the existing `check:neutral-docs` guard catches drift on the
  generated artefacts (secret-safety II1).
- `.github/workflows/integrations.yml` — runs each integration
  snippet's `smoke.sh` against the published image on every push.

### Tests

- Test count: 267 → 821 unit (+ 3 integration gated on
  `TEST_DATABASE_URL`).

## [1.1.0] — 2026-04-23

Theme: **universality, concept clarity, first-run DX, contract stability**.
Driven by roadmap `agents/roadmaps/improve-system.md` (47 tasks across
8 phases) on branch `feat/improve-system`.

### Added

- `memory migrate` CLI command — programmatic migration execution for
  scripts and CI without direct `tsx` invocation (P3-1).
- `memory serve` CLI command — long-running supervisor for Docker
  sidecars; runs migrations, parks on SIGTERM, handles clean DB
  shutdown. See ADR-0002 (P3-4a, P3-4b).
- `runMigrations()` exported from package root — programmatic migration
  for embedded setups and test harnesses (P3-2).
- Auto-migration on container start — `docker-entrypoint.sh` runs
  `memory migrate` before `memory serve`, so a fresh database is
  provisioned on first `docker compose up` (P3-3).
- `docs/consumer-setup-generic.md` — stack-agnostic integration guide
  for any language that can spawn a subprocess or speak MCP stdio
  (P1-3).
- `docs/glossary.md` — terminology source of truth, every term links
  to the authoritative source file (P2-2).
- `agents/adrs/0002-memory-serve-surface.md` — decision record for the
  supervised runtime surface.
- `agents/analysis/cold-start-transcript.md` — third-party cold-start
  verification log (P3-8).
- `src/utils/is-main-module.ts` — symlink-aware module entry detection
  with regression test coverage (P3-8).
- Contract fixture suite extended to cover `propose()`, `promote()`,
  and `deprecate()` — three new JSON Schemas + five golden fixtures
  under `tests/fixtures/retrieval/` plus
  `tests/contract/promotion-contract.test.ts` (16 tests). Blocks
  accidental shape drift across minor versions (P5-3).
- `npm run test:contract` script — runs the contract suite in
  isolation for fast local iteration (P5-3).
- `agents/adrs/0003-contract-version-bumps.md` — policy for additive
  vs. breaking changes to the five cross-package response surfaces,
  with a deprecation-window rule and approval checklist (P5-3).
- `CHANGELOG.md`, `CONTRIBUTING.md`, `SECURITY.md` — governance
  baseline for the 1.1.0 release, linked from the README (P4-1,
  P4-2, P4-3).
- `.github/ISSUE_TEMPLATE/` + `.github/PULL_REQUEST_TEMPLATE.md` —
  bug reports require `memory doctor` JSON + version; PRs require
  the six-check verification pipeline and a changelog entry (P4-4).
- `docs/integration-agent-config.md` — product-pairing guide with
  division-of-labour diagram, hydration mechanics, contract surfaces,
  and what you lose by using only one package (P5-1).
- `examples/with-agent-config/` — smoke-tested reference setup
  proving both packages resolve and cooperate (P5-2).
- `docs/compatibility-matrix.md` — full runtime × contract ×
  companion-package matrix, plus per-axis breaking-change log and
  release-level upgrade notes (P5-4).
- Four drift-prevention guards covering new Phase 0–5 surfaces, all
  wired into `.github/workflows/docs-checks.yml`:
  - `npm run check:mcp-tools` — README's `### MCP tools (N)` table
    vs. `src/mcp/tool-definitions.ts` (P6-2).
  - `npm run check:cli-commands` — README's `### CLI commands (N)`
    list vs. `program.commands` from `src/cli/index.ts` (P6-3).
  - `npm run check:neutral-docs` — strict stack-neutrality scan of
    pure-knowledge docs (glossary, comparisons, tutorial) (P6-4).
  - `npm run check:changelog` — `package.json` version must have a
    matching `## [X.Y.Z]` section in `CHANGELOG.md` (P6-6).

### Changed

- README and AGENTS.md positioning rewritten as **stack-agnostic** —
  no more "Node or PHP/Laravel" framing; PHP/Laravel is *one* example
  among Node, Python, Go, shell (P1-6, P1-7).
- `docs/data-model.md` reviewed end-to-end and aligned with
  `src/types.ts`, migrations, and trust-scoring implementation (P0-2).
- Dockerfile exposes `memory` on `PATH` via `/usr/local/bin/memory`
  symlink; entry point now runs `docker-entrypoint.sh` → `memory serve`
  (P3-3, P3-4b).
- `docker-compose.yml` and sidecar example services default to
  `memory serve` instead of `tail -f /dev/null` — the container now
  actively manages its own lifecycle (P3-4b).
- Test count: 246 → 267 (added `runMigrations()` + `isMainModule`
  unit coverage in Phase 3, +16 promotion-contract tests in P5-3).
- CLI command count: 14 → 16 (added `migrate`, `serve`).
- `REPO_ROOT` semantics in the Docker image clarified — defaults to
  `/workspace` inside the container (see `examples/laravel-sidecar/`
  and `examples/with-agent-config/`), no longer inherited from the
  host's `process.cwd()` when the image boots via `memory serve`.

### Fixed

- CLI entry detection under symlink invocation — `memory migrate`,
  `memory health`, `memory status`, and `memory mcp` no longer exit
  silently when invoked via `/usr/local/bin/memory` in Docker. Root
  cause: naive `process.argv[1] === fileURLToPath(import.meta.url)`
  returned false because `argv[1]` held the symlink path while the
  module URL resolved to the real file. Fixed with `realpathSync`
  on both sides (P3-8).
- `memory serve` no longer exits after startup. Node 20 detects
  unsettled top-level `await` as a deadlock and terminates — signal
  handlers do not count as active handles. Added explicit
  `setInterval(..., 1 << 30)` keep-alive, cleared on shutdown (P3-8).

### Renamed

> Hard renames, no redirect stubs. Tag `1.0.0` is days old and no
> external links to the old paths are known to be in circulation.

- `docs/consumer-setup-php.md` → **`docs/consumer-setup-docker-sidecar.md`**
  — retitled "Consumer setup — Docker sidecar (any stack)"; Laravel
  code snippet retained as one example among several (P1-2).
- `examples/php-laravel-sidecar/` → **`examples/laravel-sidecar/`**
  — directory name no longer implies Laravel is the canonical PHP
  path (P1-4).

## [1.0.0] — 2026-04-22

First tagged release. Shipped via PR #2 (`feat/improve-setup`) — a
32-task setup roadmap across 6 phases that made the package consumable
outside this repository.

### Added

- Multi-stage Dockerfile + first-party `docker compose` service
  definition.
- GHCR publish workflow — `ghcr.io/event4u-app/agent-memory` on push
  to `main` and on tag.
- `memory mcp` CLI subcommand for spawning the stdio MCP server.
- `memory doctor` CLI command for environment diagnostics.
- Consumer setup guides — `docs/consumer-setup-php.md` (renamed in
  1.1.0, see above) and `docs/consumer-setup-node.md`.
- Runnable examples — `examples/php-laravel-sidecar/` (renamed in
  1.1.0, see above) and `examples/node-programmatic/`.
- DevContainer / Codespaces config — zero-setup Node 20 + Postgres +
  pgvector.
- CLI doc generator (`scripts/generate-cli-docs.ts`) and drift-guard
  CI workflow.
- Lychee link-check CI workflow.
- Foreign-identifier portability guard CI workflow.
- Reproducible 60-second demo driver (`docs/media/record-demo.sh`).
- `README.md` quick-start leads with a one-command Docker start.

### Changed

- `publishConfig.access: public` for npm publishing.
- Package `exports` map with `.` and `./cli` subpath exports.
- `postinstall` → `agent-config` sync is now non-fatal and optional,
  so the package installs cleanly without the companion present.
- Repository metadata (`repository`, `homepage`, `bugs`) in
  `package.json`.

## [0.1.0] — V1 baseline

Internal baseline (no tag). Hybrid memory architecture for AI coding
agents — working / episodic / semantic tiers, BM25 + vector retrieval
with Reciprocal Rank Fusion and progressive disclosure, trust scoring
with decay, quarantine, contradiction detection, semantic drift, and
privacy filter. MCP stdio server with 23 tools, CLI with 14 commands,
240 tests. `package.json` version pinned at `0.1.0` through the
`1.0.0` tag; `1.1.0` will bump `package.json` to match the Git tag.

[Unreleased]: https://github.com/event4u-app/agent-memory/compare/1.1.0...HEAD
[1.1.0]: https://github.com/event4u-app/agent-memory/releases/tag/1.1.0
[1.0.0]: https://github.com/event4u-app/agent-memory/releases/tag/1.0.0
