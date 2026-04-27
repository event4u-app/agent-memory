# Roadmap: Team-Wide Agent Memory Deployment

> Centralize agent memory on shared infrastructure so the agent learns from every developer's promoted findings across all projects, while keeping each developer's in-flight scratch work private until they explicitly promote it.

## Prerequisites

- [ ] Read `AGENTS.md` and `agents/adrs/0001-agent-memory-architecture.md`
- [ ] Read `docs/operations.md` and `docs/consumer-setup-docker-sidecar.md`
- [ ] Confirm the local single-developer setup works end-to-end (CLI + MCP + Postgres in Docker)
- [ ] List every consumer repo that should join the shared brain (at minimum: `agent-config`, `agent-memory` itself, plus the Galawork application repos)

## Context

Today every developer runs a private Postgres in a Docker volume. Memory written by one developer is invisible to every other developer and to other projects. The package's `repository` filter is exact-match (`src/retrieval/engine.ts:218`) — there is no wildcard, no list, no `org:*` tag — but **omitting** `repository` in `.agent-memory.yml` already disables the filter, so a single shared database with per-entry `scope.repository` provenance is sufficient for a team-brain mode without any package change.

Promotion gate is the privacy boundary: quarantined entries stay invisible to retrieval until `memory promote` runs, so personal scratch never leaks before the author opts in.

- **ADRs:** `0004-team-memory-hosting.md`, `0005-team-memory-auth.md`, `0006-team-memory-scope-policy.md` — all `Accepted` since Phase 1 closed.
- **Related:** `agents/roadmaps/archive/from-agent-config/road-to-cross-project-learning.md` (V2 design — deferred, prerequisites now in scope here)

## Phase 1: Decisions (no infra yet)

Each decision must land as an ADR before its implementation phase starts. No code, no infra spend until Phase 1 is `[x]`.

- [x] **Step 1 — Hosting:** Hetzner Cloud CX22 in EU-Falkenstein, self-managed Postgres+pgvector in Compose. Backups via nightly `pg_dump` to Hetzner Storage Box. Total ≈ €8.82/mo, well under the €25 ceiling. Decision recorded in [ADR-0004](../adrs/0004-team-memory-hosting.md).
- [x] **Step 2 — Auth model:** Tailscale tailnet as the network gate, layered with the existing `MEMORY_MCP_AUTH_TOKEN` bearer (defense in depth). SSO offboarding via the Tailscale group. Decision recorded in [ADR-0005](../adrs/0005-team-memory-auth.md).
- [x] **Step 3 — Scope default:** team-brain default — every consumer `.agent-memory.yml` omits `repository:`. Per-entry `scope.repository` provenance preserved for query-time filtering. Decision recorded in [ADR-0006](../adrs/0006-team-memory-scope-policy.md).
- [x] **Step 4 — Privacy boundary:** policy floor for shared memory documented in [`docs/secret-safety.md`](../../docs/secret-safety.md#policy-floor-for-shared--team-memory-deployments). The existing pattern catalog is the technical floor; the policy floor adds end-customer PII, production data snippets, and personal opinions to the never-shared list.
- [x] **Step 5 — Promotion authority:** any developer may promote their own entries. The existing trust pipeline (validators + contradiction detector + poison-cascade) is the V1 quality gate. Re-evaluation trigger: ≥ 3 false promotions per quarter. Decision recorded in [ADR-0006](../adrs/0006-team-memory-scope-policy.md).

## Phase 2: Single-user spike

- [ ] **Step 1:** Provision the chosen host with Postgres 16 + `pgvector`, network-locked to the chosen auth model.
- [ ] **Step 2:** Deploy the package's `memory serve --mcp-http` (or `memory mcp` over the chosen transport) per `docs/mcp-http.md`.
- [ ] **Step 3:** Point a single developer's `.agent-memory.yml` at the remote endpoint, run `memory health` and `memory doctor` against it, capture latency and error budget.
- [ ] **Step 4:** Run `memory propose` → `memory promote` → `memory retrieve` round-trip from two different consumer repos with `repository` omitted; confirm both repos see the same promoted entry.
- [ ] **Step 5:** Run for at least 5 working days. Record any operational papercuts in `agents/analysis/team-memory-spike-notes.md`.

## Phase 3: Team rollout

- [x] **Step 1:** Update `docs/consumer-setup-*.md` with the agreed auth flow and the new default `.agent-memory.yml` shape. — `consumer-setup-docker-sidecar.md` §4 covers the SSE transport, 1Password-backed bearer fetch, `memory health` curl probe, and team-brain `.agent-memory.yml`. Pattern C added to `consumer-setup-generic.md`; SSE alternative added to `consumer-setup-node.md` §4.
- [ ] **Step 2:** Add an onboarding script (`scripts/team-memory-onboard.sh` or equivalent) that provisions per-developer credentials and verifies connectivity end-to-end.
- [ ] **Step 3:** Roll out to all consumer repos in waves (start with the two agent-* repos, then app repos). Each repo's `.agent-memory.yml` is updated in its own PR; this roadmap does not edit other repos directly.
- [ ] **Step 4:** Add a `memory doctor` invocation to each consumer's `task ci` (or equivalent) so a broken connection fails CI fast instead of silently degrading retrieval.

## Phase 4: Migration of existing local DBs

- [ ] **Step 1:** Inventory every developer's local Postgres volume; identify any entries already promoted that should survive the cutover.
- [ ] **Step 2:** Use `memory export` on each local instance (see `docs/cli-reference.md`) to produce per-developer NDJSON snapshots.
- [ ] **Step 3:** Filter snapshots to validated/promoted entries only — quarantine and personal scratch stay local; do not lift them to shared infra without explicit author consent.
- [ ] **Step 4:** Apply `memory import` against the shared instance with a dry-run pass first; record duplicates and merge decisions.
- [ ] **Step 5:** Deprecate local Postgres volumes; document the `docker compose down -v` path for each developer once they have confirmed shared retrieval works for them.

## Phase 5: Operations

- [ ] **Step 1:** Backups — daily logical dump + weekly base backup (or RDS snapshots if managed). Restore drill once before declaring done.
- [ ] **Step 2:** Monitoring — at minimum: DB CPU, connection count, retrieval p95 latency from the consumer side, error rate on `/mcp` endpoint. Pick a destination (existing Galawork stack vs. lightweight UptimeKuma).
- [ ] **Step 3:** Capacity plan — record entry count + storage size per month for 3 months; set a soft cap and alert.
- [ ] **Step 4:** Offboarding runbook — when a dev leaves: revoke their credential, confirm no quarantined entries owned by them block retrieval (poison-cascade-aware), update ADR-0005 if the auth model changed.

## Acceptance Criteria

- [ ] Every developer can read promoted entries written by every other developer, across at least two consumer repos.
- [ ] Quarantined entries written by developer A are *not* retrievable by developer B (verified by a deliberate test).
- [ ] `memory health` returns `status: ok` from every consumer, including the `agent-config` and `agent-memory` repos.
- [ ] Restore-from-backup drill succeeded once, with the resulting timestamp recorded in this roadmap.
- [ ] All five phase-related ADRs (`0004`–`0006` minimum) are committed with `Status: Accepted`.
- [ ] No local Postgres volume is required for normal agent work; `docs/operations.md` reflects that.

## Notes

- **Cost ceiling:** Phase 1 must produce an explicit monthly cost estimate. If the chosen hosting + auth combination exceeds €25/month for the team, re-open the hosting decision.
- **Reversibility:** The spike (Phase 2) must be cheap to abandon. Avoid managed services with multi-month commitments until Phase 5 ops are proven.
- **No package patch in scope.** This roadmap relies entirely on existing primitives (`repository` exact-match + opt-out, promotion gate, `memory export`/`import`, `memory serve --mcp-http`). If a real limitation surfaces, log it under `agents/analysis/` and open a separate roadmap — do not bolt package changes onto this one.
- **Out of scope:** multi-tenant isolation between teams (single-team brain only), end-user-facing UI, write-side ACLs beyond the auth boundary.
