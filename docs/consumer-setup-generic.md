# Consumer setup — any language, any stack

Language-neutral quick reference for using `@event4u/agent-memory` with
any application. Pick the integration style that matches how your code
already talks to external tooling.

> **Deeper guides** (all optional — this page covers the universal
> patterns):
> - Full Docker sidecar reference → [`consumer-setup-docker-sidecar.md`](consumer-setup-docker-sidecar.md)
> - Node / TypeScript programmatic use → [`consumer-setup-node.md`](consumer-setup-node.md)
> - Runnable examples → [`../examples/`](../examples/)

## The two universal integration patterns

Pick one. You do **not** need both. Both patterns work from any host OS
and any language.

### Pattern A · Docker sidecar + CLI subprocess

Best for: CI jobs, server-side code, anything that can spawn a child
process and parse JSON on stdout.

```bash
# Start the sidecar once per project
curl -o docker-compose.yml \
  https://raw.githubusercontent.com/event4u-app/agent-memory/main/docker-compose.yml
docker compose up -d agent-memory

# Talk to it from any language by shelling out to docker
docker compose exec -T agent-memory memory health
# → { "status": "ok", "features": [...] }
```

Full setup (Postgres, networking, read-only repo mount for validators)
is documented in [`consumer-setup-docker-sidecar.md`](consumer-setup-docker-sidecar.md).

### Pattern B · MCP stdio client

Best for: AI coding agents (Claude Desktop, Cursor, Cline, Augment,
Continue, Zed, …). The agent is the client; `agent-memory` is the MCP
server.

```jsonc
// Agent's MCP config file (location varies per client)
{
  "mcpServers": {
    "agent-memory": {
      "command": "docker",
      "args": ["compose", "-f", "/abs/path/to/project/docker-compose.yml",
               "exec", "-i", "agent-memory", "memory", "mcp"]
    }
  }
}
```

Any MCP-aware client that supports stdio transport works without a
custom plugin.

### Pattern C · MCP over SSE (shared / team-memory brain)

Best for: teams running a single shared `agent-memory` brain that every developer connects to instead of running a local Postgres + sidecar. No local containers; the client speaks SSE over HTTP to a remote listener (typically reachable only over a private network like Tailscale).

```jsonc
{
  "mcpServers": {
    "agent-memory": {
      "transport": "sse",
      "url": "http://memory-brain:7078/sse",
      "headers": { "Authorization": "Bearer ${MEMORY_MCP_AUTH_TOKEN}" }
    }
  }
}
```

Bearer comes from a secret manager (e.g. `op read 'op://Engineering/team-memory/mcp-bearer'`), never from a tracked file. Full deployment runbook: [`deploy/team-memory/README.md`](../deploy/team-memory/README.md). Consumer-side details (token fetching, `.agent-memory.yml` shape, troubleshooting): [`consumer-setup-docker-sidecar.md` §4](consumer-setup-docker-sidecar.md#4--team-memory-remote-mode).

## Mental model

```
┌───────────────────────┐           ┌───────────────────────┐
│ your app (any lang)   │           │ AI agent (any client) │
└──────────┬────────────┘           └──────────┬────────────┘
           │ subprocess / CLI                  │ MCP stdio
           ▼                                   ▼
        ┌────────────────────────────────────────┐
        │  agent-memory sidecar (Docker)         │
        │  ─ CLI: 14 JSON-returning commands     │
        │  ─ MCP: 23 tools                       │
        │  ─ Postgres + pgvector under the hood  │
        └────────────────────────────────────────┘
```

Both the CLI and the MCP surface call the same services — the choice
is purely about which transport your client speaks.

## Minimum viable integration (any language)

The smallest useful integration is three calls:

1. **`memory health`** — proves the sidecar is alive before you rely on it.
2. **`memory retrieve "…"`** — fetch relevant memories for the current task.
3. **`memory propose …`** — record a new learning (manually or from an
   agent observation). Promoted to `validated` later by `memory promote`.

Every CLI command prints JSON on stdout and uses exit code 0 on success.
Parse stdout, check exit code, done. See
[`docs/cli-reference.md`](cli-reference.md) for the full signature list.

## Examples per language

Runnable starter projects live in [`examples/`](../examples/):

| Example | Stack |
|---|---|
| [`examples/laravel-sidecar/`](../examples/laravel-sidecar/) | Laravel + Docker |
| [`examples/node-programmatic/`](../examples/node-programmatic/) | Node / TypeScript |
| *(more contributions welcome)* | |

All examples follow the same shape: a `docker-compose.yml`, a tiny demo
script in the host language, and a `README.md` that boots the stack
with `docker compose up -d` and verifies `memory health`.

## Next steps

- **Use it with an agent** → [`consumer-setup-docker-sidecar.md`](consumer-setup-docker-sidecar.md) §2
- **Trust / decay / invalidation model** → [`data-model.md`](data-model.md)
- **Every env var** → [`configuration.md`](configuration.md)
- **Every CLI command** → [`cli-reference.md`](cli-reference.md)
