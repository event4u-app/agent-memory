# Example — Laravel + agent-memory sidecar

Minimal runnable compose project that demonstrates how a Laravel app
talks to the `@event4u/agent-memory` sidecar over the compose network.

This is **one** example of the Docker sidecar pattern. The same pattern
works for any PHP framework (Symfony, plain PHP, …) or any other
language — see [`docs/consumer-setup-docker-sidecar.md`](../../docs/consumer-setup-docker-sidecar.md)
for Python / Go / shell variants of the same integration.

## 3-step setup

```bash
# 1. From this directory
cp .env.example .env

# 2. Boot the stack (postgres → agent-memory)
docker compose up -d

# 3. Smoke test
docker compose exec agent-memory memory health
# → { "status": "ok", "features": [...] }
```

At this point you can:

- Connect any MCP client via `docker compose exec -i agent-memory memory mcp`.
- Call the CLI from PHP code on the host (see [`php-demo.php`](php-demo.php)).
- Run the demo script from the host: `php php-demo.php` — requires PHP
  8.1+ and `docker` on the host PATH.

## What's in here

| File | Purpose |
|---|---|
| `docker-compose.yml` | Postgres + agent-memory, no app service |
| `.env.example` | Three env vars your Laravel app needs |
| `php-demo.php` | 50-line script that ingests + retrieves a memory |

## Using this in a real Laravel app

1. **Merge `docker-compose.yml`** — copy the `postgres` and
   `agent-memory` services into your existing compose file. Keep the
   `depends_on: { agent-memory: { condition: service_healthy } }` on
   your app service so nothing boots before migrations complete.
2. **Copy the env vars** — add the three `AGENT_MEMORY_*` entries from
   `.env.example` to your Laravel `.env`.
3. **Wrap the CLI** — use the `php-demo.php` pattern inside a Laravel
   Action class or service. Inject `Symfony\Component\Process\Process`
   for testability.

See the [Docker sidecar setup guide](../../docs/consumer-setup-docker-sidecar.md)
for MCP client configuration, CI integration, examples in other
languages, and the troubleshooting table.

## Teardown

```bash
docker compose down -v
```

The `-v` flag also removes the `pgdata` volume — useful between
experiments, destructive in production.
