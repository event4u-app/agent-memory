# Integration snippets — `agent-memory`

Maintained, smoke-tested snippets for wiring `@event4u/agent-memory`
into the editors, CI systems, and runtime stacks teams actually use.

Every snippet in this tree is exercised by
[`.github/workflows/integrations.yml`](../../.github/workflows/integrations.yml),
so a change that breaks a copy-paste path turns CI red before it ships.

> This directory is the **only** single-source-of-truth for integrations.
> The repository README links here; individual integrations must not be
> referenced from elsewhere in the docs. That avoids the common drift
> where snippets on the landing page and in docs slowly diverge.
>
> Full index with usage notes: [`docs/integrations.md`](../../docs/integrations.md).

## What lives here

| Snippet | Transport | Smoke in CI |
|---|---|---|
| [`claude-desktop/`](claude-desktop/) | MCP stdio | ✅ config validates + `memory mcp` boots |
| [`cursor/`](cursor/) | MCP stdio | ✅ config validates + `memory mcp` boots |
| [`github-actions/`](github-actions/) | CLI | ✅ meta-smoke: same steps run in this repo's CI |
| [`docker-sidecar-laravel/`](docker-sidecar-laravel/) | HTTP / CLI exec | ✅ via [`examples/laravel-sidecar/`](../laravel-sidecar/) |
| [`docker-sidecar-django/`](docker-sidecar-django/) | HTTP | ✅ compose up + `curl /health` |

## Non-goals

- This is **not** an installer or a package. Every integration is a
  copy-paste template that you adapt to your repo. Pin versions, read
  the README, don't assume the snippet replaces thinking about your
  deployment.
- No Windows-specific variants — the commands use `docker compose`
  (v2 plugin) and POSIX shell. Adapt to PowerShell as needed.

## Contributing a new integration

1. Copy one of the existing snippets as a starting point; keep the same
   README structure (what · when · copy-paste · smoke).
2. Add a job to [`.github/workflows/integrations.yml`](../../.github/workflows/integrations.yml)
   that proves the snippet boots — no "trust me" integrations.
3. Add a row to the index in [`docs/integrations.md`](../../docs/integrations.md).
