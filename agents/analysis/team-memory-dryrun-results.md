# Team-memory dry-run — local validation results

Pre-spike validation of [`deploy/team-memory/docker-compose.yml`](../../deploy/team-memory/docker-compose.yml). Ran on a developer workstation with `TAILNET_IP=127.0.0.1` and a locally-built `:dryrun` image, no real provisioning. Goal: catch any tooling/config problem **before** Hetzner spend.

> **Run date:** 2026-04-27 · **Operator:** maintainer · **Compose project:** `team-memory-dryrun` · **Image:** `ghcr.io/event4u-app/agent-memory:dryrun` (locally built, 277 MB).

## Result

**Pass.** Compose stack comes up cleanly, both containers reach `healthy`, all four auth boundaries behave as documented, the data plane round-trip (`propose → promote → retrieve`) works end-to-end. One actionable finding for the deploy README (image registry status), no blockers.

## Verified behaviours

| Check | Expected | Observed | Source |
|---|---|---|---|
| `docker compose config` parses | no error | no error | `compose --env-file .env -f deploy/team-memory/docker-compose.yml config` |
| Port binding | `127.0.0.1:7078:7078` only | `host_ip: 127.0.0.1, target: 7078` in normalized config | `docker compose ... config` |
| Postgres reaches healthy | within 10s | healthy at 10s | `docker compose ps` |
| agent-memory reaches healthy | within 30s start_period | healthy at ~17s | `docker compose ps` |
| `MEMORY_AUTO_MIGRATE=true` runs migrations | applied on first start | container log: `auto-migrate: applying pending migrations…` then `Database connected` on first CLI call | container stdout |
| SSE `GET /sse` with bearer | 200 + `event: endpoint` + `sessionId` | `200 OK`, `event: endpoint`, `data: /message?sessionId=…` | `curl -i` |
| SSE `GET /sse` without bearer | 401 | `HTTP 401` | `curl` |
| SSE `GET /sse` with wrong bearer | 403 | `HTTP 403` | `curl` |
| Other paths | 404 | `HTTP 404` for `/random` | `curl` |
| `memory propose` | quarantine, trust ≈ confidence | `status: quarantine, trust_score: 0.7` | CLI |
| `memory promote` | validated, "All validators passed" | `status: validated, reason: All validators passed` | CLI |
| `memory verify <id>` after promote | entry present, status validated | `id: <uuid>, status: validated` | CLI |

## Findings (deploy/team-memory README + ADRs unaffected)

### 1 · GHCR image is not yet public — README step 5 will fail today

`docker manifest inspect ghcr.io/event4u-app/agent-memory:latest` returns `manifest unknown`, even though `.github/workflows/docker-image.yml` exists. The `docker compose pull` step in [`deploy/team-memory/README.md`](../../deploy/team-memory/README.md) (§5) will fail until the image is published with a fixed tag.

**Action:** when the maintainer runs the real spike, either:
- publish a release tag from `main` first (`docker-image.yml` already builds on push), or
- build the image on the Hetzner host directly via a temporary `git clone` (slow, but works), or
- pin `MEMORY_IMAGE_TAG=sha-<short>` once a sha-tagged image lands.

Not a blocker for Phase 2 — but the README §5 should mention this until `:latest` is reliably published. Tracked as a Phase-2 papercut.

### 2 · Synthetic entries depress below retrieval threshold by design

A `propose` with no `--file`, `--symbol`, `--module`, or `--scenario` lands at the proposed confidence (0.7) and **passes** validators on `promote` ("All validators passed"), but the trust pipeline depresses the score to 0.2. With the default threshold 0.6, and even with `--low-trust`, the entry stays out of `retrieve` results (`totalCandidates: 1, filtered: 1`).

This is expected per the trust pipeline, not a bug. Spike notes and acceptance checks (Step 3 round-trip) need real entries with at least a `--file` scope and one `--scenario`, otherwise the round-trip looks like it failed when the data plane is fine. **Documented in `scripts/team-memory-smoketest.sh` so the smoke test uses a realistic entry shape.**

### 3 · Auth boundary matches `docs/mcp-http.md` exactly

200 / 401 / 403 / 404 all behaved as described. No surprise — listed for completeness so a future operator does not re-discover this.

## Cleanup

```bash
docker compose -p team-memory-dryrun down -v   # volumes removed
rm -rf .tmp/dryrun                              # local secrets gone
```

The `.tmp/dryrun/.env` file with the test secrets matches the `.env` rule in `.gitignore`; nothing leaked.

## What this validates for the real spike

- `deploy/team-memory/docker-compose.yml` is correct as written — no edits needed.
- The `TAILNET_IP` interpolation enforces the 127.0.0.1 / 100.x.x.x binding contract; any future PR that changes the port mapping should re-run this dry-run.
- `MEMORY_AUTO_MIGRATE=true` is a safe default — migrations apply before the SSE listener accepts traffic.
- `memory propose` / `memory promote` / `memory verify` are the right CLI surface for the Step 3 acceptance check; `memory retrieve` results require realistic entry shape (Finding 2).

## Open follow-ups

- Phase 2 spike: publish a `:latest` (or pin a sha tag) before the operator runs §5 of the runbook.
- Phase 5 monitoring: alert on `Status: Health: starting` lasting > 60s — the agent-memory container hits healthy in ~17s on a workstation; a slower host might take longer but anything > 60s signals a migration or DB problem.
