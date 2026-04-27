# Team-memory spike — operations log

Phase 2 of [`agents/roadmaps/team-memory-deployment.md`](../roadmaps/team-memory-deployment.md). Single-developer 5-working-day spike on the shared Hetzner brain. This file is the source of truth for the spike's findings; it is read by anyone deciding whether to roll out to the rest of the team.

> **Spike start:** _<YYYY-MM-DD, fill in when Phase 2 Step 1 completes>_
> **Spike end:** _<YYYY-MM-DD, +5 working days>_
> **Operator:** _<name — single dev running the spike>_
> **Brain host:** _<tailnet hostname, e.g. memory-brain>_
> **Image tag:** _<MEMORY_IMAGE_TAG from .env>_
>
> **Pre-spike dry-run:** Local Compose validation completed 2026-04-27 — see [`team-memory-dryrun-results.md`](team-memory-dryrun-results.md). Outcome: pass; one papercut (GHCR image not yet public, runbook §5 needs a sha-pinned tag or a `git clone` build on the host). Use [`scripts/team-memory-smoketest.sh`](../../scripts/team-memory-smoketest.sh) for the Step 3 acceptance round-trip.

## Acceptance checks (Phase 2 Steps 3–4)

- [ ] `memory health` returns `status: ok` from the operator's machine.
- [ ] `memory doctor` reports no errors.
- [ ] Round-trip from repo A: `memory propose` → `memory promote` → entry visible.
- [ ] Round-trip from repo B (different consumer repo, `repository:` omitted): same entry retrievable.
- [ ] Quarantine isolation verified: a `memory propose` in repo A is **not** visible from repo B until promotion.

## Daily log

Append one entry per working day. Keep it short — symptoms, root cause, action.

### Day 1 — _<date>_

- **Stood up:** _<what was done>_
- **Latency:** `memory retrieve` p50 / p95 over 20 sample queries: _ms / _ms
- **Errors:** _<count + summary, or "none">_
- **Notes:** _<anything surprising>_

### Day 2 — _<date>_

- **Latency:** _
- **Errors:** _
- **Notes:** _

### Day 3 — _<date>_

- **Latency:** _
- **Errors:** _
- **Notes:** _

### Day 4 — _<date>_

- **Latency:** _
- **Errors:** _
- **Notes:** _

### Day 5 — _<date>_

- **Latency:** _
- **Errors:** _
- **Notes:** _

## Operational papercuts

Anything that hurt during the spike — rough edges in the runbook, surprising defaults, missing docs, slow paths. One bullet per item; one ticket / follow-up per item.

- _<symptom — how it was worked around — proposed fix>_

## Cost reality check

| Line | Estimated (ADR-0004) | Actual |
|---|---|---|
| Hetzner CX22 | €5.83/mo | _ |
| Hetzner Storage Box BX11 | €2.99/mo | _ |
| Egress (any?) | €0 | _ |
| **Total** | **€8.82/mo** | _ |

If actual exceeds **€25/mo**, re-open ADR-0004.

## Latency reality check

`memory retrieve` from a developer machine over the tailnet should be in the same order of magnitude as a local-Compose query. Capture five representative queries:

| Query | Local (baseline) | Remote (tailnet) | Delta |
|---|---|---|---|
| _ | _ms | _ms | _ |
| _ | _ms | _ms | _ |
| _ | _ms | _ms | _ |
| _ | _ms | _ms | _ |
| _ | _ms | _ms | _ |

If p95 delta exceeds **+200ms** consistently, raise it as a papercut and investigate (likely Postgres `shared_buffers` or Tailscale MTU).

## Restore drill (preview — Phase 5 Step 1 owns the real one)

If a backup is taken during the spike, run the restore drill once and record:

| Field | Value |
|---|---|
| Backup size (compressed) | _ MB |
| Restore start → `status: ok` | _ minutes |
| Steps that needed correction | _ |

## Decision after Day 5

- [ ] **Proceed to Phase 3 rollout** — all acceptance checks green, no blocking papercuts, cost within ceiling.
- [ ] **Extend spike** — at least one acceptance check failed; describe the gap and the fix.
- [ ] **Abandon and reconsider** — fundamental issue with the chosen host or auth model. If picked, open a follow-up ADR superseding the affected Phase 1 decision.

Signed off by: _<operator>_ on _<date>_.
