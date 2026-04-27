# ADR-0004: Team memory hosting

> **Status:** Accepted
> **Date:** 2026-04-27
> **Roadmap:** `agents/roadmaps/team-memory-deployment.md` (Phase 1, Step 1)
> **Related:** ADR-0001 (single Postgres + pgvector), ADR-0002 (`memory serve`).

## Context

The team-memory deployment roadmap requires a single shared
Postgres+pgvector instance reachable from every developer's machine
and from CI for the consumer repos in scope (at minimum `agent-config`,
`agent-memory`, plus the Galawork application repos). The decision is
*where* that instance runs.

Constraints carried in from the roadmap:

- **Cost ceiling:** the chosen hosting + auth combination must stay
  under €25/month for the team. Above that, re-open this ADR.
- **Reversibility:** the spike (Phase 2) must be cheap to abandon. No
  multi-month commitments before Phase 5 ops are proven.
- **Backups:** a restore drill must succeed once before declaring done
  (roadmap acceptance criterion). The hosting choice determines
  whether backups are managed or self-operated.
- **Geography / GDPR:** the team is EU-based; the brain stores
  references to internal repos. Hosting region must be EU.

The package itself is hosting-agnostic — it ships as a Node CLI plus
Docker image; any host that can run Postgres 16 with `pgvector` and
expose either a SQL port or `memory serve` over the chosen transport
qualifies.

## Options considered

### Option A — Hetzner Cloud CX22 + self-managed Postgres in Compose

Provision a CX22 (2 vCPU, 4 GB, 40 GB SSD, EU-Falkenstein/Nuremberg).
Run Postgres 16 + pgvector + `memory serve` via the existing
`docker-compose.yml`. Backups via `pg_dump` to Hetzner Storage Box or
S3-compatible bucket.

- ✅ Lowest steady-state cost (~€5/mo VM + cents for backup storage).
- ✅ EU jurisdiction, native German invoicing.
- ✅ Full control of the stack — same Compose file devs run locally.
- ✅ Reversible: tear down the VM, keep the SQL dump; nothing else to
  unwind.
- ❌ Ops burden falls on us — patching, OS upgrades, backup integrity,
  PITR if we want it (would require WAL archiving — not free in time).
- ❌ No managed PITR. Recovery RPO is "last `pg_dump`".

### Option B — AWS RDS db.t4g.micro (Postgres 16 + pgvector)

Managed Postgres in `eu-central-1`. pgvector available since Postgres
15. Automated daily backups + 7-day PITR included. `memory serve`
runs separately (Hetzner VM, Fly machine, or a small EC2/Fargate task)
and connects to RDS.

- ✅ Managed backups, 7-day PITR, automated minor-version patching.
- ✅ Low effort to scale up (storage autogrow, instance class change).
- ❌ Higher cost: db.t4g.micro ≈ $13/mo + 20 GB storage ≈ $16/mo
  total before egress. Plus the compute for `memory serve`.
- ❌ Splits the deployment in two: DB on AWS, MCP server elsewhere.
  The Compose-based local dev story stops mirroring production.
- ❌ AWS account, IAM, VPC plumbing — meaningful one-time setup cost.

### Option C — Fly.io Postgres + Fly Machine for `memory serve`

Fly Postgres app (single-node `shared-cpu-1x`, 1 GB RAM) plus a Fly
machine running the package image. EU region (`fra` / `ams`).

- ✅ Single platform for DB + serve; both deploy from the repo.
- ✅ Cheap (~$5–10/mo all-in for a single-node setup).
- ✅ Reasonable reversibility — `fly destroy` and the SQL dump.
- ❌ Fly Postgres is "unmanaged Postgres on Fly machines" — no
  automatic PITR; backups via Litestream/`pg_dump` cron, same as
  Hetzner. Not as managed as RDS.
- ❌ Smaller vendor; less leverage if we hit a platform incident.
- ❌ Region availability and quota changes have bitten Fly users
  recently — review Fly status posture before committing.

### Option D — Existing Galawork infrastructure

Run Postgres+pgvector on whatever Galawork already operates (e.g. a
shared cluster, an existing VPS pool, or the Kubernetes cluster).
`memory serve` deployed via the existing CI/CD path.

- ✅ Zero net new ops surface — extends what the team already runs.
- ✅ Likely the lowest marginal cost (no new VM/RDS bill).
- ✅ Reuses the team's existing backup, monitoring, and on-call setup.
- ❌ Couples this package to Galawork's internal infrastructure
  conventions; the open-source repo cannot demo the production setup.
- ❌ Requires inventory work first: what *exactly* is "existing
  Galawork infrastructure" today, who owns it, and is there capacity?
  Roadmap Phase 1 currently does not have this answer.

## Decision

**Option A — Hetzner Cloud CX22 + self-managed Postgres in Compose.**

| Field | Value |
|---|---|
| Region | EU-Falkenstein (`fsn1`) — German jurisdiction, matches the team's location |
| Monthly cost | ~€5.83 (CX22) + ~€2.99 (Storage Box BX11, 1 TB, backup target) ≈ **€8.82/mo** — well under the €25 ceiling |
| Backup model | Nightly `pg_dump` (custom format, gzip) + weekly base backup, both rotated 30 days on Hetzner Storage Box. No PITR in V1. |
| RPO / RTO target | RPO ≤ 24h (last nightly dump). RTO ≤ 30 min for restore drill — measured in Phase 5 Step 1. |
| Ops owner | **TBD — recorded by the maintainer who provisions the host before Phase 2 Step 1.** |
| Reversibility | `hcloud server delete <name>` + Storage Box retains last dump. Re-deploy elsewhere from the dump in <1h. Total spike abandonment: <1 day. |

### Why not the others

- **Option B (RDS)** rejected on cost (~€16/mo before egress, plus the compute for a separate `memory serve`) and on the architectural split: Compose-on-laptop ≠ RDS-in-prod weakens the local-development story.
- **Option C (Fly.io)** rejected on operational maturity. Fly Postgres is unmanaged Postgres on Fly machines, so the backup story is identical to Option A but with a smaller vendor and recent regional reliability incidents.
- **Option D (existing Galawork)** rejected for V1 because the inventory work it requires (capacity, ownership, conventions) hasn't been done. Re-evaluate at the end of Phase 5 Step 3 — if capacity exists in Galawork's own infrastructure, Option D becomes a follow-up ADR to reduce vendor surface.

## Consequences

- **Operational responsibility on us.** No managed PITR; the spike must record measured restore time (Phase 5 Step 1) before declaring done.
- **Stack mirrors local dev.** The same `docker-compose.yml` shape runs on the host and on every developer's laptop — only network exposure and credentials differ. The deploy artifact lives at `deploy/team-memory/` (added in Phase 2 prep).
- **Phase 5 Step 1 (backup drill) is mandatory.** No PITR, so the only proof of recoverability is a measured restore drill.
- **Re-evaluate at €25.** If the brain grows past 1 TB or CI concurrency exceeds CX22 capacity, the next step up (CX32, ~€13/mo) keeps us under the ceiling. Above that — re-open this ADR.

## Non-goals

- Multi-region / HA Postgres — single-region, single-node is sufficient
  for V1 team-brain volumes (thousands of entries, not millions; see
  ADR-0001).
- Multi-tenant isolation between teams — out of scope per the roadmap;
  this is a single-team brain.
- Self-hosted Kubernetes — adds ops surface that Phase 5 has not yet
  budgeted for; revisit if Option D points there.

## References

- `agents/roadmaps/team-memory-deployment.md` — Phase 1, Step 1
- ADR-0001 (DB choice — Postgres + pgvector)
- ADR-0002 (`memory serve` as supervisor process)
- `docker-compose.yml`, `Dockerfile` — current local topology
