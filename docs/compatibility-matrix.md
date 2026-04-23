# Compatibility matrix

Authoritative compatibility data for `@event4u/agent-memory`. This
page supersedes the single-row compatibility block in the README.

## Runtime requirements

| `agent-memory` | Node | Postgres (with `pgvector`) | Docker (with Compose v2) | MCP SDK |
|---|---|---|---|---|
| 0.1.x (historical) | ≥ 20 | 15+ | 24+ | [`@modelcontextprotocol/sdk`](https://www.npmjs.com/package/@modelcontextprotocol/sdk) 1.x |
| 1.0.0 | ≥ 20 | 15+ | 24+ | `@modelcontextprotocol/sdk` ^1.29 |
| 1.1.x *(current Unreleased)* | ≥ 20 | 15+ | 24+ | `@modelcontextprotocol/sdk` ^1.29 |

Minor bumps do not change the runtime row. Major bumps (2.x, 3.x) may.

## Retrieval contract versions

The contract version is an independent axis from the package version —
it is negotiated at runtime via the `contract_version` field on every
response.

| `agent-memory` range | Supported contract versions | Notes |
|---|---|---|
| 0.1.x – 1.1.x | v1 | Locked by [`tests/contract/`](../tests/contract/). Evolves additively until 2.x. |

Breaking changes to the contract (renames, type narrowing, removed
fields) require a major version bump on `agent-memory` and follow the
deprecation window in
[`agents/adrs/0003-contract-version-bumps.md`](../agents/adrs/0003-contract-version-bumps.md).

## Companion-package pairings

Verified pairings with
[`@event4u/agent-config`](https://github.com/event4u-app/agent-config).
Unlisted pairings may work but are not exercised in CI.

| `agent-memory` | `agent-config` | Contract | Status |
|---|---|---|---|
| 1.0.0 | `main` (pre-1.0) | v1 | Supported; hydration via `postinstall` tested (see [`scripts/postinstall.sh`](../scripts/postinstall.sh)). |
| 1.1.x | `main` (pre-1.0) | v1 | Supported; adds `memory migrate`, `memory serve`, contract fixtures. |

See [`docs/integration-agent-config.md`](integration-agent-config.md)
for the division of labour and what you lose by using only one.

## Breaking-change log (per axis)

The CHANGELOG covers every release; this table narrows to axis-level
breakage so operators can scan quickly.

| Date | Version | Axis | Change |
|---|---|---|---|
| 2026-04-22 | 1.0.0 | — | Initial tag; baseline for all matrix rows below. |
| 2026-04-23 | 1.1.0 (unreleased) | CLI | Adds `memory migrate`, `memory serve`. No existing command changed (additive). |
| 2026-04-23 | 1.1.0 (unreleased) | Docker | Default `CMD` changed from `tail -f /dev/null` to `memory serve`; consumer override still possible via `command:`. |
| 2026-04-23 | 1.1.0 (unreleased) | Contract | `propose/promote/deprecate` shape locked by JSON Schema. Shape unchanged; guard is new. |

Nothing past this point is considered breaking unless marked here.

## Upgrade notes

### 0.1.x → 1.0.0

Documentation-only release. No runtime change.

### 1.0.0 → 1.1.x (unreleased)

- `docker compose up -d agent-memory` now runs `memory serve` instead
  of exiting immediately. If you scripted around the old behaviour,
  use `command: sleep infinity` as an explicit override.
- `memory migrate` is now the canonical way to apply migrations from
  scripts. `tsx src/db/migrate.ts` still works and is used by `npm run
  db:migrate`, but is not a stable surface.
- The rename `docs/consumer-setup-php.md` → `docs/consumer-setup-docker-sidecar.md`
  has no redirect stub. Update any deep links you bookmarked.
- The rename `examples/php-laravel-sidecar/` → `examples/laravel-sidecar/`
  is similarly a hard rename.

## How this matrix is maintained

- Every tag adds a row to the runtime table and every applicable
  "per axis" row to the breaking-change log.
- The CI `check:changelog` guard ensures the CHANGELOG has a section
  for `package.json`'s current version before a release.
- Future: a `check:compat` guard that fails CI if a CHANGELOG entry
  marks a row "breaking" without updating this matrix (deferred).
