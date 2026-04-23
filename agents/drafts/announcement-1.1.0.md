# `@event4u/agent-memory` 1.1.0 — announcement draft

> **Status:** draft for GitHub Discussions / Slack / internal channel.
> Not auto-published. Paste when the `1.1.0` tag is live.
> Shorter and punchier than the release notes; purpose is to signal
> the positioning shift and point readers at the new entry points.

---

## Headline

**`agent-memory` 1.1.0 is out — stack-agnostic, one-command start,
locked retrieval contract.**

## The one-paragraph version

`@event4u/agent-memory` gives AI coding agents persistent,
trust-scored project memory — an MCP server and CLI backed by
PostgreSQL + pgvector. 1.1.0 closes the universality gap (PHP/Laravel
is now *one* example, not the headline), ships the DX glue
(`memory migrate`, `memory serve`, auto-migrate on container start),
and locks the cross-package retrieval contract behind JSON schema
fixtures. Any language that can spawn a subprocess or speak MCP stdio
is a first-class caller.

## What to read first

- **Installing it:** [`README.md`](../../README.md) — a one-command
  Docker start.
- **Calling it from your stack:**
  [`docs/consumer-setup-generic.md`](../../docs/consumer-setup-generic.md)
  — Python, Go, Ruby, shell, or anything else that can spawn a
  subprocess. Docker-sidecar variant lives in
  [`docs/consumer-setup-docker-sidecar.md`](../../docs/consumer-setup-docker-sidecar.md).
- **Pairing it with `@event4u/agent-config`:**
  [`docs/integration-agent-config.md`](../../docs/integration-agent-config.md)
  explains the division of labour
  (behaviour ↔ persistence) and
  [`examples/with-agent-config/`](../../examples/with-agent-config/)
  is a smoke-tested reference setup.
- **What runs on what:**
  [`docs/compatibility-matrix.md`](../../docs/compatibility-matrix.md)
  — runtime × contract × companion-package pairings, with a
  breaking-change log per axis.
- **What it is not:** the Non-goals section in the README.

## New public surface

| Surface | What it's for |
|---|---|
| `memory migrate` | Programmatic migrations for scripts, CI, or a container entrypoint. |
| `memory serve` | Long-running sidecar supervisor — migrations on boot, clean SIGTERM, managed DB lifecycle. |
| `runMigrations()` | Package-root export for embedded setups and test harnesses. |
| Auto-migrate container | Fresh `docker compose up` provisions the database on first start. |
| Contract fixtures | `propose()`, `promote()`, `deprecate()` shapes locked by JSON schema + golden fixtures. |

## Behaviour changes to be aware of

- Default container command changed from `tail -f /dev/null` to
  `memory serve`. If you relied on the old behaviour, set
  `command: sleep infinity` explicitly.
- `REPO_ROOT` inside the image now defaults to `/workspace`.
- Two hard renames (no redirects — 1.0.0 is days old):
  `docs/consumer-setup-php.md` → `docs/consumer-setup-docker-sidecar.md`,
  `examples/php-laravel-sidecar/` → `examples/laravel-sidecar/`.

## Feedback

Open an issue or a discussion — `bug` and `docs-issue` templates live
in [`.github/ISSUE_TEMPLATE/`](../../.github/ISSUE_TEMPLATE/). For
everything else, the release notes at
[`CHANGELOG.md`](../../CHANGELOG.md) are the long form.
