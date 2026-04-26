# Docker sidecar · Laravel

## What

Runs `agent-memory` as a Docker **sidecar** next to a Laravel application.
Laravel talks to it via `docker compose exec agent-memory memory <cmd>`,
parsing the JSON envelope on stdout. No PHP extension, no Composer
dependency on `@event4u/agent-memory` — the sidecar owns the code, your
app owns the `MemoryService` boundary class.

This is the realization of one of the two **stack-neutrality** proofs
required by [`runtime-trust.md` § D2](../../../agents/roadmaps/archive/runtime-trust.md).
The Django variant is its twin: [`docker-sidecar-django/`](../docker-sidecar-django/).

## When to use

- You run Laravel in Docker Compose already and want agent-memory as
  another service in the same network.
- Your team needs memory **persistent across requests and deploys** —
  sidecar + Postgres + pgvector is the supported durable setup.
- Multi-developer, shared memory — point every developer's Compose at
  the same managed Postgres (change `DATABASE_URL`).

Do **not** use this pattern if your Laravel app runs outside Docker
(serverless, bare-metal, PHP on host). For those, install the CLI on
the host and configure `AGENT_MEMORY_SERVICE=""` + a direct `memory`
binary path — see [`consumer-setup-generic.md`](../../../docs/consumer-setup-generic.md).

## Copy-paste

1. Copy [`docker-compose.example.yml`](docker-compose.example.yml) into
   your project root and **merge** the two services (`postgres`,
   `agent-memory`) into your existing compose file. Keep
   `depends_on: agent-memory: service_healthy` on your `app` service.
2. Copy [`MemoryService.example.php`](MemoryService.example.php) into
   `app/Services/MemoryService.php`. Strip the `.example` from the file
   name; the PSR-4 class name `App\Services\MemoryService` stays.
3. Bind it in `AppServiceProvider::register()`:

   ```php
   $this->app->singleton(MemoryService::class, fn () => new MemoryService(
       composeFile: base_path('docker-compose.yml'),
       repository:  config('app.name'),
   ));
   ```

4. Inject where needed:

   ```php
   public function __construct(private MemoryService $memory) {}

   $this->memory->ingest(
       'bug_pattern',
       'N+1 on Invoice::items',
       'Eager-load items in IndexController.',
   );
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
   `MemoryService.example.php` is a real CLI command — scraped from
   `memory --help`. A CLI rename upstream turns this smoke red before
   stale snippets reach users.

Run locally after `npm run build`:

```bash
MEMORY_BIN="node $(pwd)/dist/cli/index.js" \
  bash examples/integrations/docker-sidecar-laravel/smoke.sh
```

Requires `docker compose` (v2) on the host — it is a sidecar integration
by definition, so Docker is assumed.

## What the smoke does NOT test

- Full end-to-end boot of the Compose stack — that's the job of
  [`examples/laravel-sidecar/`](../../laravel-sidecar/), the backing
  "boot it yourself" reference that this integration distills.
- Laravel's DI container wiring — that is consumer-side, out of scope.
- `docker compose exec` actually running inside the container — the
  smoke validates the **template**, not the runtime. Runtime is validated
  by the backing laravel-sidecar example and by the consumer.

## Deeper guide

See [`docs/consumer-setup-docker-sidecar.md`](../../../docs/consumer-setup-docker-sidecar.md)
for the language-neutral explanation of this pattern, MCP-client wiring
across editors, troubleshooting, and the shared env-var contract.
