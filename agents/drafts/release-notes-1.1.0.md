# `@event4u/agent-memory` 1.1.0 — draft release notes

> **Status:** draft — paste into the GitHub release form when P7-1
> pushes the `1.1.0` tag. Matches the `[1.1.0]` section in
> [`CHANGELOG.md`](../../CHANGELOG.md) one-to-one; the CHANGELOG stays
> the source of truth, this file just shapes the text for GitHub's
> release UI.

## Highlights

Theme: **universality, concept clarity, first-run DX, contract stability.**

The 1.0.0 tag made the package consumable outside its home repo. 1.1.0
finishes the universality refactor, locks the cross-package retrieval
contract, and ships the DX glue (`memory migrate`, `memory serve`,
auto-migrate on container start) that turns "clone, configure, maybe
it works" into `docker compose up -d`.

**No behaviour changes to existing CLI or MCP surfaces.** All additions
are additive; all renames are documented with migration paths below.

## Added

- **`memory migrate`** — programmatic migration CLI for scripts and
  CI without direct `tsx` invocation.
- **`memory serve`** — long-running supervisor for Docker sidecars;
  runs migrations, parks on SIGTERM, handles clean DB shutdown. See
  [ADR-0002](../adrs/0002-memory-serve-surface.md).
- **`runMigrations()`** — exported from the package root for embedded
  setups and test harnesses.
- **Auto-migration on container start** — `docker-entrypoint.sh` runs
  `memory migrate` before `memory serve`, so a fresh database is
  provisioned on first `docker compose up`.
- **Retrieval contract fixtures** — JSON Schemas + golden fixtures for
  `propose()`, `promote()`, `deprecate()` on top of the existing
  `retrieve()` / `health()` coverage. 16 new contract tests. Any
  accidental shape change now fails CI in one gate. Policy:
  [ADR-0003](../adrs/0003-contract-version-bumps.md).
- **`npm run test:contract`** — runs the contract suite in isolation.
- **New documentation**
  - [`docs/integration-agent-config.md`](../../docs/integration-agent-config.md) — how `agent-config` and `agent-memory` combine.
  - [`docs/compatibility-matrix.md`](../../docs/compatibility-matrix.md) — runtime × contract × companion-package matrix.
  - [`docs/consumer-setup-generic.md`](../../docs/consumer-setup-generic.md) — stack-agnostic integration guide.
  - [`docs/glossary.md`](../../docs/glossary.md) — terminology source of truth.
- **Governance baseline** — `CHANGELOG.md`, `CONTRIBUTING.md`,
  `SECURITY.md`, issue + PR templates.
- **Combined example** — [`examples/with-agent-config/`](../../examples/with-agent-config/) pairs both packages with a smoke-test script.
- **Four drift-prevention guards** — `check:mcp-tools`,
  `check:cli-commands`, `check:neutral-docs`, `check:changelog`, all
  wired into `docs-checks.yml`.

## Changed

- **README and AGENTS.md positioning rewritten as stack-agnostic.** No
  more "Node or PHP/Laravel" framing; PHP/Laravel is *one* example
  among Node, Python, Go, shell.
- **`docs/data-model.md`** reviewed end-to-end and aligned with
  `src/types.ts`, migrations, and trust-scoring implementation.
- **Dockerfile** exposes `memory` on `PATH` via `/usr/local/bin/memory`
  symlink; entry point now runs `docker-entrypoint.sh` → `memory serve`.
- **`docker-compose.yml`** and sidecar example services default to
  `memory serve` instead of `tail -f /dev/null` — the container now
  actively manages its own lifecycle.
- **`REPO_ROOT`** inside the image now defaults to `/workspace` (see
  `examples/laravel-sidecar/` and `examples/with-agent-config/`).
- **Test count:** 246 → 267. **CLI command count:** 14 → 16.

## Fixed

- **CLI entry detection under symlink invocation.** `memory migrate`,
  `memory health`, `memory status`, and `memory mcp` no longer exit
  silently when invoked via `/usr/local/bin/memory` in Docker. Fixed
  with `realpathSync` on both the CLI entry and the comparison URL.
- **`memory serve`** no longer exits after startup. Node 20 detects
  unsettled top-level `await` as a deadlock — added explicit
  `setInterval(..., 1 << 30)` keep-alive, cleared on shutdown.

## Renamed (hard renames — no redirect stubs)

| Old path | New path |
|---|---|
| `docs/consumer-setup-php.md` | [`docs/consumer-setup-docker-sidecar.md`](../../docs/consumer-setup-docker-sidecar.md) |
| `examples/php-laravel-sidecar/` | [`examples/laravel-sidecar/`](../../examples/laravel-sidecar/) |

If you have a bookmark or deep link to either old path, update it
before upgrading. Tag `1.0.0` is days old; no external references to
these paths are known to be in circulation.

## Upgrade notes

- No runtime changes. `npm install` / `docker compose pull` + restart.
- If you relied on the old `docker compose` default of `tail -f /dev/null`,
  set `command: sleep infinity` explicitly — the new default
  (`memory serve`) actively supervises the process and auto-runs
  migrations.
- If you scripted around `tsx src/db/migrate.ts`, switch to
  `memory migrate` — same behaviour, stable CLI surface.

## Verification on tag

Every check in this matrix passed on the exact commit that will carry
the tag. CI runs the same pipeline on the tagged commit.

| Gate | Command |
|---|---|
| Lint | `npm run lint` |
| Typecheck | `npm run typecheck` |
| Tests | `npm test` |
| Contract tests | `npm run test:contract` |
| CLI docs drift | `npm run docs:cli:check` |
| Foreign-identifier leakage | `npm run check:portability` |
| Neutral-docs strictness | `npm run check:neutral-docs` |
| MCP tool count | `npm run check:mcp-tools` |
| CLI command count | `npm run check:cli-commands` |
| CHANGELOG freshness | `npm run check:changelog` |
| Link health | `npm run check:links` |

## Pointers

- Full changelog — [`CHANGELOG.md`](../../CHANGELOG.md)
- Companion-package integration — [`docs/integration-agent-config.md`](../../docs/integration-agent-config.md)
- Compatibility matrix — [`docs/compatibility-matrix.md`](../../docs/compatibility-matrix.md)
- Roadmap that drove this release — [`agents/roadmaps/improve-system.md`](../roadmaps/improve-system.md)
