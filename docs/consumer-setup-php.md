# Consumer setup — PHP / Laravel

End-to-end guide for integrating `@event4u/agent-memory` into a PHP or
Laravel project. **No Node install required on the host** — everything
runs as a Docker sidecar next to your app.

## What you get

- A persistent, trust-scored project memory for any MCP-aware agent
  (Augment, Claude Desktop, Cursor, Cline).
- A `memory` CLI you can invoke from PHP code, Artisan commands, or
  CI pipelines via `docker compose exec`.
- Zero PHP dependencies. The integration is infrastructure, not a
  Composer package.

## Prerequisites

- Docker 24+ with Docker Compose v2 (`docker compose`, not `docker-compose`).
- An MCP-aware agent client (for agent use). CLI use has no client
  requirement.

## 1 · Drop the sidecar into your stack

Pick one of the two patterns below.

### Pattern A — standalone sidecar next to your app

Works for any PHP app that doesn't already use `docker compose`.

```bash
# In your project root:
curl -o docker-compose.agent-memory.yml \
  https://raw.githubusercontent.com/event4u-app/agent-memory/main/docker-compose.yml
docker compose -f docker-compose.agent-memory.yml up -d agent-memory
docker compose -f docker-compose.agent-memory.yml exec agent-memory memory health
#  → { "status": "ok", "features": [...] }
```

### Pattern B — merge into an existing `docker-compose.yml`

If you already have a compose file (e.g. for `php-fpm`, `nginx`,
`mysql`), paste the two services below. The `postgres` service uses port
`5433` on the host to avoid clashing with any existing `5432`.

```yaml
# docker-compose.yml (excerpt)
services:
  # ... your existing php-fpm, nginx, mysql, etc.

  agent-memory-postgres:
    image: pgvector/pgvector:pg17
    environment:
      POSTGRES_DB: agent_memory
      POSTGRES_USER: memory
      POSTGRES_PASSWORD: memory_dev
    volumes: [ "agent-memory-pgdata:/var/lib/postgresql/data" ]
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U memory -d agent_memory"]
      interval: 5s
      retries: 5

  agent-memory:
    image: ghcr.io/event4u-app/agent-memory:latest
    depends_on:
      agent-memory-postgres: { condition: service_healthy }
    environment:
      DATABASE_URL: postgresql://memory:memory_dev@agent-memory-postgres:5432/agent_memory
      REPO_ROOT: /workspace
    volumes: [ ".:/workspace:ro" ]    # read-only host mount for file validators
    entrypoint: ["/sbin/tini", "--"]
    command: ["tail", "-f", "/dev/null"]
    healthcheck:
      test: ["CMD", "memory", "health"]
      interval: 10s
      start_period: 15s

volumes:
  agent-memory-pgdata:
```

The `REPO_ROOT` + read-only mount lets the memory backend verify that
files and symbols referenced in memory entries actually exist in your
repository — a core part of the trust-scoring gate.

## 2 · Connect your MCP agent

### Augment / Claude Desktop / Cursor

Find your client's MCP config file (e.g.
`~/Library/Application Support/Claude/claude_desktop_config.json`) and
add this entry. Replace `/abs/path/to/your/project` with the absolute
path to the directory that contains the compose file.

```json
{
  "mcpServers": {
    "agent-memory": {
      "command": "docker",
      "args": [
        "compose",
        "-f", "/abs/path/to/your/project/docker-compose.yml",
        "exec", "-i", "agent-memory",
        "memory", "mcp"
      ]
    }
  }
}
```

Restart the client. You should see the 23 `memory_*` tools in the
tool picker.

## 3 · Use the CLI from PHP, Artisan, or CI

The CLI is a thin wrapper around the MCP tools, emits JSON on stdout,
and is safe to call from anywhere `docker` is available.

```php
// From any PHP code, e.g. a Laravel service:
$process = new \Symfony\Component\Process\Process([
    'docker', 'compose', 'exec', '-T', 'agent-memory',
    'memory', 'retrieve', '--query', 'how do invoices work?',
    '--type', 'architecture_decision', '--limit', '5',
]);
$process->mustRun();
$memories = json_decode($process->getOutput(), true);
```

```bash
# From an Artisan command or composer script:
docker compose exec -T agent-memory memory health
docker compose exec -T agent-memory memory status   # → present / absent / misconfigured
```

For CI, see [`examples/consumer-ci.yml`](../examples/consumer-ci.yml)
— a ready-made GitHub Actions snippet that spins up the stack and runs
a health check.

## 4 · Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `executable file not found in $PATH` on `docker compose exec agent-memory memory …` | Image predates 0.1.0 | `docker compose pull agent-memory` |
| `healthcheck … status: error` | Postgres not yet migrated | Wait 15s (start_period); check `docker compose logs agent-memory-postgres` |
| `status: misconfigured` | `DATABASE_URL` env mismatch | Verify the URL hostname matches the Postgres service name inside the compose network |
| MCP client can't see tools | Stale client cache | Restart the client; for Claude, quit fully (`⌘Q`) |

Still stuck? Open an issue at
<https://github.com/event4u-app/agent-memory/issues> with the output of
`docker compose logs agent-memory` and `docker compose exec agent-memory memory health`.
