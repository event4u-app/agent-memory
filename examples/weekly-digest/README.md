# Weekly digest → Slack

> **Phase C4 · runtime-trust** — adoption reminder without extra infrastructure.

A GitHub-Actions cron that calls
`memory review --weekly --format slack-block-kit` and posts the
result into a Slack channel. No bot, no long-running service — the
action runs on GitHub's schedule, talks to your existing
`agent-memory` Postgres, and finishes in seconds.

## What it looks like

Once a week, the team channel receives a Slack block with three
sections:

- **Stale high-value entries** — validated entries with `impact_level`
  in `high|critical` whose `validated_at` is older than the decay
  window. Each line links to `memory explain <id>`.
- **Unresolved contradictions** — pairs of entries flagged as
  contradictions that nobody has resolved yet.
- **Poison candidates** — entries that tripped the poison detector
  (`invalidation_count` above the decay-calibrated threshold) and are
  awaiting `memory poison` / `memory rollback`.

If all three categories are empty, no message is posted (the workflow
exits 0 without the Slack step running).

## Files

| File | Purpose |
|---|---|
| `digest.yml` | GitHub Actions workflow (cron + Slack push) |

## Setup

**1. Copy the workflow**

```bash
mkdir -p .github/workflows
cp path/to/agent-memory/examples/weekly-digest/digest.yml \
  .github/workflows/memory-weekly-digest.yml
```

**2. Configure the secrets**

In the repository settings (`Settings → Secrets and variables → Actions`):

| Secret | Purpose |
|---|---|
| `DATABASE_URL` | Postgres DSN pointing at the `agent-memory` DB |
| `SLACK_WEBHOOK_URL` | Incoming webhook for the target channel |

**3. Adjust the schedule**

Default is Mondays 09:00 UTC. Edit the `cron:` line in `digest.yml` to
match your team's rhythm.

## How it works

The workflow:

1. Checks out your repository (so `.agent-memory.yml` is on disk and
   the CLI can read `repository:`, `trust.threshold`, etc.).
2. Starts Postgres only if you're using a self-hosted runner without
   network access to your production DB. For SaaS DBs (e.g. Neon,
   Supabase), skip the service container and point `DATABASE_URL` at
   your hosted instance.
3. Runs `npx --package=@event4u/agent-memory memory review --weekly
   --format slack-block-kit` — output goes to stdout as a Slack
   Block Kit JSON payload (shape defined by the `review-weekly-v1`
   contract; see
   `tests/fixtures/retrieval/review-weekly-v1.schema.json`).
4. Pipes the JSON to `slackapi/slack-github-action`.

The `--weekly` flag already applies the 7-day defer filter, so entries
that a teammate marked `review_deferred` within the last week don't
resurface in this run.

## Contract stability

Output shape is pinned by the `review-weekly-v1` JSON schema and
tested by [`tests/contract/review-weekly-contract.test.ts`]
(../../tests/contract/review-weekly-contract.test.ts). If we ever ship
a breaking change, this example's `memory review --weekly` invocation
stays on the old contract until you update the version pin in the
workflow.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `memory: project config schema error` | Run `memory doctor` locally — the workflow fails fast on a bad `.agent-memory.yml`. |
| Empty Slack message | Expected when nothing is stale / contradicted / poisoned. Add a `if:` guard or post a "✅ memory clean this week" message manually. |
| Webhook 404 | Slack rotated the webhook — regenerate via the Slack app and update the secret. |
| Workflow silently skipped | Check `.github/workflows/memory-weekly-digest.yml` cron syntax against `crontab.guru`. |

## Not included

- **Alerting** — this is a digest, not a pager. For critical-path
  policy failures use `memory policy check` in a required PR check
  (see [`C2` in the roadmap](../../agents/roadmaps/runtime-trust.md)).
- **Historical trends** — the digest is a snapshot. If you want a
  trend line, persist each run's JSON into your data warehouse and
  chart from there.
