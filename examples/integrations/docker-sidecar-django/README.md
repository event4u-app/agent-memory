# Docker sidecar · Django

## What

Runs `agent-memory` as a Docker **sidecar** next to a Django application.
Django talks to it via `docker compose exec agent-memory memory <cmd>`,
parsing the JSON envelope on stdout. No Python extension, no pip
dependency on `@event4u/agent-memory` — the sidecar owns the code, your
app owns the `MemoryService` boundary class.

This is the realization of one of the two **stack-neutrality** proofs
required by [`runtime-trust.md` § D2](../../../agents/roadmaps/runtime-trust.md).
The Laravel variant is its twin: [`docker-sidecar-laravel/`](../docker-sidecar-laravel/).

## When to use

- You run Django in Docker Compose already and want agent-memory as
  another service on the same network.
- Your team needs memory **persistent across requests and deploys** —
  sidecar + Postgres + pgvector is the supported durable setup.
- Multi-developer, shared memory — point every developer's Compose at
  the same managed Postgres (change `DATABASE_URL`).

Do **not** use this pattern if your Django app runs outside Docker
(serverless, bare-metal, Python on host). For those, install the CLI
on the host and configure a direct `memory` binary path — see
[`consumer-setup-generic.md`](../../../docs/consumer-setup-generic.md).

## Copy-paste

1. Copy [`docker-compose.example.yml`](docker-compose.example.yml) into
   your project root and **merge** the two services (`postgres`,
   `agent-memory`) into your existing compose file. Keep
   `depends_on: agent-memory: service_healthy` on your `web` service.
2. Copy [`memory_service.example.py`](memory_service.example.py) into
   `myproject/services/memory_service.py`. Strip the `.example` from the
   filename.
3. Wire it via Django settings:

   ```python
   # settings.py
   AGENT_MEMORY_COMPOSE_FILE = BASE_DIR / "docker-compose.yml"
   AGENT_MEMORY_REPOSITORY = "my-django-app"
   ```

4. Instantiate once (module-level, or in `apps.py`) and use:

   ```python
   from django.conf import settings
   from myproject.services.memory_service import MemoryService

   memory = MemoryService(
       compose_file=str(settings.AGENT_MEMORY_COMPOSE_FILE),
       repository=settings.AGENT_MEMORY_REPOSITORY,
   )

   # views.py
   def index(request):
       memory.ingest(
           "bug_pattern",
           "N+1 on Invoice.items",
           "Use select_related('items') in the list view.",
       )
       hits = memory.retrieve("invoice calculation")
       ...
   ```

### Running the stack for the first time

```bash
docker compose up -d
docker compose exec agent-memory memory health
# → { "status": "ok", "features": [...] }
```

The sidecar auto-applies pending migrations on first boot (see
[ADR-0002](../../../agents/adrs/0002-memory-serve-surface.md)).
Opt out with `MEMORY_AUTO_MIGRATE=false` if you want migration control.

## Smoke check

[`smoke.sh`](smoke.sh) is a **static** check — it does not boot the
stack (that needs 60+ seconds and image pulls). It validates:

1. `docker-compose.example.yml` parses via `docker compose config`.
2. Services `postgres` and `agent-memory` are both defined.
3. The `agent-memory` service has a `healthcheck` (the contract that
   makes `service_healthy` dependency gating work).
4. Every `memory <subcommand>` referenced in
   `memory_service.example.py` is a real CLI command — scraped from
   `memory --help`. A CLI rename upstream turns this smoke red before
   stale snippets reach users.

Run locally after `npm run build`:

```bash
MEMORY_BIN="node $(pwd)/dist/cli/index.js" \
  bash examples/integrations/docker-sidecar-django/smoke.sh
```

Requires `docker compose` (v2) on the host — it is a sidecar integration
by definition, so Docker is assumed.

## What the smoke does NOT test

- Full end-to-end boot of the Compose stack — exercising the real
  subprocess path is a consumer-side responsibility. The twin
  [Laravel reference project](../../laravel-sidecar/) is the closest
  "boot it yourself" demo; a Django equivalent can reuse the same
  `docker-compose.yml` with a Django `web:` service on top.
- Django's app registry / settings loading — consumer-side, out of
  scope.
- `docker compose exec` actually running inside the container — the
  smoke validates the **template**, not the runtime. Runtime is the
  consumer's first-boot smoke.

## Deeper guide

See [`docs/consumer-setup-docker-sidecar.md`](../../../docs/consumer-setup-docker-sidecar.md)
for the language-neutral explanation of this pattern, MCP-client wiring
across editors, troubleshooting, and the shared env-var contract.
