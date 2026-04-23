# Changelog

All notable changes to `@event4u/agent-memory` are documented in this file.

The format is based on [Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning 2.0.0](https://semver.org/spec/v2.0.0.html).

Version tracking note: the Git tag `1.0.0` was created before `package.json`
was bumped — the baseline package version on tag `1.0.0` is `0.1.0`. The
`1.1.0` release (see below) brings `package.json` in line with the Git tag.

## [Unreleased] — 1.1.0

Theme: **universality, concept clarity, first-run DX, contract stability**.
Driven by roadmap `agents/roadmaps/improve-system.md` (47 tasks across
8 phases). Sections below list items shipped so far on branch
`feat/improve-system`; the release entry will be rewritten into a fixed
date + version header at tag time (P7-1).

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
- Test count: 246 → 251 (added `runMigrations()` + `isMainModule`
  unit coverage).
- CLI command count: 14 → 16 (added `migrate`, `serve`).

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

[Unreleased]: https://github.com/event4u-app/agent-memory/compare/1.0.0...HEAD
[1.0.0]: https://github.com/event4u-app/agent-memory/releases/tag/1.0.0
