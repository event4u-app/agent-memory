# MCP over HTTP/SSE

`agent-memory` speaks MCP over two transports:

| Transport | When to use | Startup |
|---|---|---|
| **stdio** (default) | Local agents (Claude Desktop, Cursor, Cline, CLI-spawned subprocess) | `memory mcp` |
| **SSE over HTTP** | Remote callers that cannot spawn a subprocess (GitHub Actions, Slack webhooks, ingestion workers, browser-based playgrounds) | `memory mcp --transport sse --port 7078` |

Both transports share the same tool surface (23 tools) and the same backend — only the wire is different.

## Running the SSE listener

```bash
export MEMORY_MCP_AUTH_TOKEN="$(openssl rand -hex 32)"
memory mcp --transport sse --port 7078
```

| Flag | Default | Purpose |
|---|---|---|
| `--transport` | `stdio` | `stdio` or `sse` |
| `--port` | `7078` | TCP port for the HTTP listener |
| `--host` | `0.0.0.0` | Bind address — set to `127.0.0.1` to refuse remote traffic |

| Env var | Required when | Purpose |
|---|---|---|
| `MEMORY_MCP_AUTH_TOKEN` | `--transport sse` | Static bearer token enforced on every `/sse` GET and `/message` POST — the server **refuses to start** without a non-empty token |
| `DATABASE_URL` | always | Postgres DSN (same as stdio) |

### Endpoints

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `GET` | `/sse` | `Authorization: Bearer <token>` | Open an SSE stream. Response header announces the per-connection `sessionId`. |
| `POST` | `/message?sessionId=<id>` | `Authorization: Bearer <token>` | Send a JSON-RPC request into an existing session. Response streams back over the SSE channel from step 1. |

Every other route returns **404**. Missing / empty bearer → **401**. Wrong bearer → **403**.

> **Note:** The MCP SDK is migrating from `SSEServerTransport` to `StreamableHTTPServerTransport`. We stay on SSE for now because all current MCP clients (Claude Desktop, Cursor, Cline) still speak it. A follow-up task can add Streamable HTTP without touching the SSE path — both share `buildMcpServer()`.

## Client configurations

### Generic MCP SDK client (Node / TypeScript)

```ts
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";

const token = process.env.MEMORY_MCP_AUTH_TOKEN!;
const transport = new SSEClientTransport(new URL("http://memory.internal:7078/sse"), {
  eventSourceInit: {
    fetch: (url, init) =>
      fetch(url, { ...init, headers: { ...(init?.headers ?? {}), authorization: `Bearer ${token}` } }),
  },
  requestInit: { headers: { authorization: `Bearer ${token}` } },
});

const client = new Client({ name: "my-agent", version: "0.1.0" });
await client.connect(transport);
const res = await client.callTool({ name: "memory_retrieve", arguments: { query: "…" } });
```

### Claude Desktop (SSE, via `mcp-remote` bridge)

Claude Desktop expects stdio in `claude_desktop_config.json`. Use `npx mcp-remote` to bridge:

```json
{
  "mcpServers": {
    "agent-memory": {
      "command": "npx",
      "args": [
        "-y",
        "mcp-remote",
        "http://memory.internal:7078/sse",
        "--header",
        "Authorization: Bearer ${env:MEMORY_MCP_AUTH_TOKEN}"
      ]
    }
  }
}
```

### Cursor

Cursor supports SSE directly — add to `~/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "agent-memory": {
      "url": "http://memory.internal:7078/sse",
      "headers": { "Authorization": "Bearer ${MEMORY_MCP_AUTH_TOKEN}" }
    }
  }
}
```

## Security posture (what is NOT included)

A4 intentionally ships the minimum viable auth story. Out of scope:

- **Multi-tenant identity** — one shared token per deployment. Rotate by redeploying.
- **mTLS / client certs** — put a reverse proxy (nginx, Traefik, AWS ALB) in front if you need TLS or cert auth.
- **Per-user RBAC** — all authenticated callers see the same memory scope.
- **Rate limiting** — put it at the proxy layer.

See the **Non-Goals** section in `agents/roadmaps/archive/runtime-trust.md` for the full list.

## Operations

### Health probes

The SSE listener is a sibling of the `/health` + `/ready` HTTP server (A1). Run both behind the same reverse proxy:

```yaml
# docker-compose.yml fragment
services:
  memory:
    command: memory mcp --transport sse --port 7078
    environment:
      MEMORY_MCP_AUTH_TOKEN: ${MEMORY_MCP_AUTH_TOKEN}
      MEMORY_HTTP_PORT: "7079"    # /health + /ready + /metrics
    ports:
      - "7078:7078"
      - "7079:7079"
```

### Troubleshooting

| Symptom | Likely cause |
|---|---|
| `MEMORY_MCP_AUTH_TOKEN is required` on startup | Set the env var to a non-empty string before `memory mcp --transport sse` |
| `401 unauthorized` | Client did not send `Authorization: Bearer …` |
| `403 forbidden` | Bearer token mismatch (rotate both sides) |
| `404 session not found` on POST | SSE GET was never completed, or the session has since closed. Reconnect GET /sse first. |
| Client hangs on `listTools` | Proxy buffering SSE — disable response buffering for `/sse` (nginx: `proxy_buffering off`) |

## Contract test

`tests/contract/sse-transport.test.ts` spins up the listener on a free port and runs a full `listTools` + `callTool` roundtrip through `SSEClientTransport`. Run it with `npm test -- tests/contract/sse-transport.test.ts`.
