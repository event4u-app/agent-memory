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

Status matrix is maintained in [`docs/integrations.md`](../../docs/integrations.md)
— this table mirrors it, but a row only appears here once the
directory is real and its `smoke.sh` is wired into CI.

| Snippet | Transport | Status |
|---|---|---|
| [`claude-desktop/`](claude-desktop/) | MCP stdio | ✅ Available |
| [`github-actions/`](github-actions/) | CLI | ✅ Available |

Planned, tracked in [`runtime-trust.md` § D2](../../agents/roadmaps/runtime-trust.md):
`cursor`, `docker-sidecar-laravel`
(backing in [`../laravel-sidecar/`](../laravel-sidecar/)), `docker-sidecar-django`.

## Non-goals

- This is **not** an installer or a package. Every integration is a
  copy-paste template that you adapt to your repo. Pin versions, read
  the README, don't assume the snippet replaces thinking about your
  deployment.
- No Windows-specific variants — the commands use `docker compose`
  (v2 plugin) and POSIX shell. Adapt to PowerShell as needed.

## Contributing a new integration

1. Copy `claude-desktop/` as a starting point; keep the same README
   structure (what · when · copy-paste · smoke).
2. Ship an executable `smoke.sh` that exits 0 on success. No "trust me"
   integrations. The workflow at
   [`.github/workflows/integrations.yml`](../../.github/workflows/integrations.yml)
   auto-discovers any subdirectory with `README.md` + `smoke.sh` — no
   CI edit needed.
3. Flip the row in [`docs/integrations.md`](../../docs/integrations.md)
   from 🚧 Planned to ✅ Available and mirror it in the table above.
