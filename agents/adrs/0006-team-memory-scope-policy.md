# ADR-0006: Team memory scope policy + promotion authority

> **Status:** Proposed
> **Date:** 2026-04-27
> **Roadmap:** `agents/roadmaps/team-memory-deployment.md` (Phase 1, Steps 3 & 5)
> **Related:** ADR-0001 (trust / promotion gate), `src/retrieval/engine.ts:218` (repository filter).

## Context

A single shared Postgres+pgvector backend serves multiple consumer
repos (at minimum `agent-config`, `agent-memory`, and the Galawork
application repos). Two policy questions must be settled before Phase
2 begins:

1. **Scope default** — when a consumer repo's `.agent-memory.yml`
   does not pin `repository:`, the package's exact-match repository
   filter (`src/retrieval/engine.ts:218`) is disabled and retrieval
   spans every repo in the brain. This is precisely the team-brain
   behaviour the roadmap wants — but it is also a footgun if a repo
   owner expected per-project isolation.
2. **Promotion authority** — `memory promote` is the privacy
   boundary (ADR-0001 Decision 9). Today any developer with CLI
   access can promote any of their own quarantined entries to
   `validated`. With a shared backend that promotion is now visible
   to the whole team. The question is whether that authority stays
   per-developer or moves to a review model.

These are two separate decisions, but they share one ADR because they
both shape what "shared brain" means in practice.

## Decision 1 — Scope default

### Options

#### A. Strict per-repo (`repository:` set in every consumer)

Every consumer's `.agent-memory.yml` must include `repository: <slug>`.
Cross-project retrieval requires deliberate removal of the line.

- ✅ Safest default — accidental cross-pollination is impossible.
- ✅ Matches the V1 single-repo mental model in ADR-0001.
- ❌ Defeats the whole point of the team-brain roadmap by default.
  Cross-project learning ("we already solved this in repo X") only
  fires for developers who edit their config.
- ❌ Onboarding friction: every new repo needs a config decision.

#### B. Team-brain default (drop `repository:` everywhere)

The recommended `.agent-memory.yml` template omits `repository:`.
Retrieval spans every repo in the brain by default. Per-entry
provenance is preserved via the entry's own `scope.repository`
field; consumers can still filter at query time if they want.

- ✅ Realises the roadmap's stated goal — every developer benefits
  from every other developer's promoted findings, automatically.
- ✅ Single config story across all consumer repos.
- ❌ A poorly-scoped entry (e.g. one that names a function name
  common to many repos) can surface in unrelated contexts. Mitigated
  by the trust gate, contradiction detector, and `scope.module`
  hints, but not eliminated.
- ❌ Requires more discipline at promotion time (Decision 2 below).

#### C. Hybrid — opt-in team-brain per repo

Default is strict (A); team-brain is enabled per-repo by an
explicit `repository:` removal plus a positive `team_brain: true`
flag in `.agent-memory.yml`.

- ✅ No surprises — team-brain is always a deliberate act.
- ❌ The flag does not exist in the package today. Adding it
  contradicts the roadmap's "no package patch in scope" rule.
- ❌ Splits the team into "team-brain repos" and "isolated repos",
  inviting drift on which is which.

### Decision

**Open.** Resolve during Phase 1, Step 3. The decision must record
the recommended `.agent-memory.yml` template for every consumer
category (agent-* repos, application repos, libraries) and update
`docs/consumer-setup-*.md` accordingly.

## Decision 2 — Promotion authority

### Options

#### A. Any developer may promote their own entries

Status quo. `memory promote` is gated only by quarantine validators
(file-exists, symbol-exists, contradiction). No human review.

- ✅ Zero friction — the agent flow that exists today keeps working.
- ✅ The trust pipeline already filters obvious garbage.
- ❌ A wrong-but-valid entry (passes validators, but the *claim* is
  inaccurate) reaches the whole team's retrieval immediately. The
  poisoned-cascade machinery exists (ADR-0001 Decision 4) but is a
  recovery tool, not a prevention tool.

#### B. Maintainers-only promotion

Promotion via CLI is restricted to a named maintainer group. Other
developers can `memory propose` (creates quarantine entry) but not
promote. Maintainers run a periodic `memory promote --review` pass.

- ✅ Quality gate before team-wide visibility.
- ❌ Bottleneck — every dev's learning waits on a human. Defeats
  the agent-driven learning loop unless the queue is short.
- ❌ Requires a new role and an SLA.

#### C. PR-style review (promotion proposals as PRs)

Quarantined entries surface as suggested promotions in a PR-like
flow (e.g. an issue queue, a Slack channel, or a small UI). At
least one other developer must `+1` before promotion runs.

- ✅ Distributed review — no single bottleneck.
- ✅ Creates a paper trail for sensitive promotions.
- ❌ The package has no PR-flow primitive today. Building one is
  out of roadmap scope ("no package patch in scope").
- ❌ Risk of becoming theatrical — `+1` rubber-stamping is worse
  than no review at all.

### Decision

**Open.** Resolve during Phase 1, Step 5. The decision must record
who may run `memory promote`, the review tooling (if any), and the
escape valve for time-sensitive promotions.

## Consequences (to be filled when decisions are made)

To be written when status flips from `Proposed` to `Accepted`.

## Non-goals

- Per-entry ACLs beyond the trust/quarantine model.
- Multi-team isolation — single-team brain only.
- Auto-classification of entries as "team-relevant" vs "personal" —
  the human-driven promote step is the boundary.

## References

- `agents/roadmaps/team-memory-deployment.md` — Phase 1, Steps 3 & 5
- ADR-0001 — trust statuses, quarantine → validated flow (Decision 9)
- `src/retrieval/engine.ts:218` — repository filter (exact-match,
  disabled when omitted)
- `docs/consumer-setup-docker-sidecar.md`,
  `docs/consumer-setup-generic.md`,
  `docs/consumer-setup-node.md` — current consumer config docs
