# Cursor integration

## What

Wires `agent-memory` into [Cursor](https://cursor.com) as an MCP server
over stdio. Cursor's MCP config uses the same `mcpServers` JSON shape as
Claude Desktop, so the binary-level integration is identical — but
Cursor lets you **check the config into the repo** at
`.cursor/mcp.json`, which turns "agent-memory in Cursor" from a
per-developer setup chore into a team-wide default.

## When to use

- Your team already uses Cursor and you want everyone's agent sessions
  reading from the same memory store without a per-dev onboarding step.
- You have a [sidecar](../../../docs/consumer-setup-docker-sidecar.md)
  in the repo (`docker-compose.yml` at the root) — the project-local
  config path assumes that.
- Single-user-per-session. Each dev's Cursor boots its own MCP
  subprocess; all subprocesses talk to the shared backend.

Do **not** check in an `mcp.json` that pins absolute paths from your
machine. The `${workspaceFolder}` variable is the entire reason to
prefer the project-local path over the global one.

## Copy-paste

Cursor reads MCP servers from two locations, in this precedence order:

| Scope | Path | When |
|---|---|---|
| Project (shared) | `.cursor/mcp.json` at repo root | recommended — team gets the config via `git pull` |
| Global (per-user) | `~/.cursor/mcp.json` | personal override, not shared |

Copy [`mcp.example.json`](mcp.example.json) into `.cursor/mcp.json` at
the **root of your project** (not in this repo — in the repo you want
agent-memory to serve). Commit it. The `${workspaceFolder}` variable is
expanded by Cursor at launch and resolves to your project root, so the
relative `docker-compose.yml` reference works on every teammate's
machine without edits.

Restart Cursor. Check **Settings → MCP** — `agent-memory` should show
as `connected` with 26 tools discovered.

### Option B — npm-installed binary (no Docker)

If you ran `npm install -g @event4u/agent-memory`, swap the `command`
+ `args` block for:

```json
{
  "type": "stdio",
  "command": "memory",
  "args": ["mcp"],
  "env": {
    "DATABASE_URL": "postgresql://memory:memory_dev@localhost:5433/agent_memory",
    "REPO_ROOT": "${workspaceFolder}"
  }
}
```

`REPO_ROOT` is required — validators resolve file and symbol citations
against it. `${workspaceFolder}` keeps the config portable; without it
the `file-exists` and `symbol-exists` validators fail-closed on every
propose/promote.

### Option C — envFile for secrets

If you keep credentials in a local `.env` (not committed), Cursor
supports `envFile`:

```json
{
  "type": "stdio",
  "command": "memory",
  "args": ["mcp"],
  "envFile": "${workspaceFolder}/.env.agent-memory"
}
```

This keeps `.cursor/mcp.json` safe to commit while secrets stay in
`.env.agent-memory` (gitignored).

## Smoke check

[`smoke.sh`](smoke.sh) validates three things, in order:

1. `mcp.example.json` is valid JSON.
2. `.mcpServers["agent-memory"]` has `command` (string) and `args`
   (array) — the minimum Cursor requires to boot an MCP server.
3. The `memory` binary is runnable and reports a version — proves the
   Option B variant of the config actually resolves. Uses `$MEMORY_BIN`
   if set (CI does this after `npm run build`), falls back to `memory`
   on `PATH`, finally to `node <repo>/dist/cli/index.js`.

Run locally after `npm run build`:

```bash
MEMORY_BIN="node $(pwd)/dist/cli/index.js" \
  bash examples/integrations/cursor/smoke.sh
```

Exit 0 on pass, non-zero on failure. CI runs this in
[`.github/workflows/integrations.yml`](../../../.github/workflows/integrations.yml)
on every PR touching this folder.

## What the smoke does NOT test

- Cursor itself — the editor is not in CI.
- `${workspaceFolder}` expansion — that is done by Cursor at runtime,
  not by the smoke. A broken variable name would surface on first
  launch, not here. The template uses only variables documented in
  [Cursor's MCP docs](https://cursor.com/docs/cookbook/building-mcp-server).
- An MCP `initialize` round-trip — requires Postgres. The end-to-end
  MCP protocol test lives in the unit suite
  (`tests/unit/sse-server.test.ts` and friends), not here.
- Precedence resolution between `.cursor/mcp.json` and
  `~/.cursor/mcp.json` — that is Cursor's responsibility.

## Relationship to claude-desktop

The JSON format is intentionally identical — Cursor implements Claude
Desktop's `mcpServers` shape verbatim. If you already have a working
`claude_desktop_config.json`, you can copy its `mcpServers` block into
`.cursor/mcp.json` unchanged. The only Cursor-specific addition is
`${workspaceFolder}` support, which Claude Desktop does not expand.
