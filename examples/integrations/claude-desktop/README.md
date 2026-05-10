# Claude Desktop integration

## What

Wires `agent-memory` into [Claude Desktop](https://claude.ai/download) as
an MCP server over stdio. Claude Desktop boots the MCP subprocess on
start-up, lists the 26 tools in its UI, and routes every call through
the `mcpServers.agent-memory` entry in its config file.

## When to use

- You already run Claude Desktop and want your project's architecture
  decisions, domain invariants, and prior bug root-causes available to
  it without pasting them into each conversation.
- You have a [sidecar](../../../docs/consumer-setup-docker-sidecar.md)
  running (recommended) or `@event4u/agent-memory` installed globally.
- Single-user, single-machine. For multi-user, use the HTTP transport
  — see [`docs/mcp-http.md`](../../../docs/mcp-http.md).

Do **not** use this for shared team state. Claude Desktop's MCP
transport is stdio → per-process → per-user; there is no auth layer.

## Copy-paste

Claude Desktop reads MCP servers from a single JSON file. The path is
OS-specific:

| OS | Config path |
|---|---|
| macOS | `~/Library/Application Support/Claude/claude_desktop_config.json` |
| Windows | `%APPDATA%\Claude\claude_desktop_config.json` |
| Linux | `~/.config/Claude/claude_desktop_config.json` |

Copy [`claude_desktop_config.example.json`](claude_desktop_config.example.json)
into that file (merge with existing `mcpServers` if you already have
others), then replace `/abs/path/to/your/project/docker-compose.yml`
with the **absolute path** to the compose file in your repo.

Restart Claude Desktop. The 🔌 plug icon in the input bar should list
`agent-memory` — click it to see the 26 tools.

### Option B — npm-installed binary (no Docker)

If you ran `npm install -g @event4u/agent-memory` instead, swap the
`command` + `args` block for:

```json
{
  "command": "memory",
  "args": ["mcp"],
  "env": {
    "DATABASE_URL": "postgresql://memory:memory_dev@localhost:5433/agent_memory",
    "REPO_ROOT": "/abs/path/to/your/project"
  }
}
```

`REPO_ROOT` is required — validators resolve file and symbol citations
against it. Without it the `file-exists` and `symbol-exists` validators
will fail-closed on every propose/promote.

## Smoke check

[`smoke.sh`](smoke.sh) validates three things, in order:

1. `claude_desktop_config.example.json` is valid JSON (parsed by `jq`).
2. `.mcpServers["agent-memory"]` has `command` (string) and `args`
   (array) — the minimum Claude Desktop requires to boot an MCP server.
3. The `memory` binary is runnable and reports a version (proves the
   `"command": "memory"` variant of the config actually resolves). Uses
   `$MEMORY_BIN` if set (CI does this after `npm run build`), falls
   back to `memory` on `PATH`, finally to `node <repo>/dist/cli/index.js`.

Run locally after `npm run build`:

```bash
MEMORY_BIN="node $(pwd)/dist/cli/index.js" \
  bash examples/integrations/claude-desktop/smoke.sh
```

Exit 0 on pass, non-zero on failure. CI runs this in
[`.github/workflows/integrations.yml`](../../../.github/workflows/integrations.yml)
on every PR touching this folder — a broken copy-paste path will
turn the workflow red before it ships.

## What the smoke does NOT test

- Claude Desktop itself — we cannot spawn the GUI in CI.
- An actual MCP `initialize` round-trip — requires Postgres. The
  deeper end-to-end MCP protocol test lives in the unit suite
  (`tests/unit/sse-server.test.ts` and friends), not here. If the
  binary is runnable and the config shape is valid, Claude Desktop
  will boot the server correctly; any failure from that point on is
  Postgres/config, not integration-template drift.
- The absolute path substitution — you have to fix that for your
  machine. A fully-parameterized template that resolves $CWD would
  hide the fact that Claude Desktop reads an absolute path.
