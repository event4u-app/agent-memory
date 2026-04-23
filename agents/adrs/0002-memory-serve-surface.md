# ADR-0002: `memory serve` — Long-running container surface

> **Status:** Accepted
> **Date:** 2026-04-22
> **Roadmap:** `agents/roadmaps/archive/improve-system.md` (P3-4a)
> **Supersedes partially:** ADR-0001 container section (retains the
> `docker compose exec` usage pattern; replaces `tail -f /dev/null`).

## Context

Reviewer feedback on PR #2/#3 flagged the container's long-running
process as "a clever workaround, not a final runtime story":

```yaml
# docker-compose.yml (today)
command: ["tail", "-f", "/dev/null"]
```

The pattern works — consumers spawn every CLI call via
`docker compose exec -i agent-memory memory …` and the stdio MCP
server is launched per-session by the client. But it has friction:

- The healthcheck runs `memory health` which opens a fresh Postgres
  connection every 10s — fine, but it obscures whether the container
  itself is doing anything.
- There is no steady-state process; `ps` inside the container shows
  only `tini` and `tail`. Operators reading `docker compose top`
  cannot tell a healthy container apart from a zombie.
- Adding features that need in-process state (warm caches, embedded
  scheduler for decay/archival, watchers) is blocked until a real
  supervisor process exists.

## Options considered

### Option A — Keep `tail -f /dev/null`, do nothing

- ✅ Zero code change; compatible with every existing consumer.
- ❌ Persists the reviewer criticism; blocks any in-process feature.
- ❌ Healthcheck is the only signal of life.

### Option B — Supervisor-only `memory serve`

Long-running Node process that:

1. Runs `memory migrate` on startup (delegates to P3-1 / P3-3).
2. Registers SIGTERM/SIGINT handlers, flushes Postgres pool, exits.
3. Sleeps on `setInterval(noop, 60_000)` to stay alive.

- ✅ Clean `ps` output; single supervised process.
- ✅ Trivial to bolt on background timers (decay/archival) later.
- ❌ No external liveness endpoint beyond `memory health` CLI.

### Option C — Supervisor + HTTP liveness/readiness endpoint

Same as Option B, plus a minimal HTTP server on `MEMORY_SERVE_PORT`
(default `3100`) that exposes `/healthz` (liveness) and `/readyz`
(readiness — DB reachable, migrations applied).

- ✅ k8s-native probes work out of the box.
- ✅ Foundations laid for a future HTTP MCP transport.
- ❌ New port to manage, new attack surface, conflicts with the
  "stdio-only" positioning in README / `docs/configuration.md`.
- ❌ Most consumers use Docker Compose with CLI-based healthchecks —
  they don't need HTTP liveness.

## Decision

**Adopt Option B.** Ship `memory serve` as a supervisor-only
long-running command in 1.1.0. Defer HTTP liveness (Option C) until a
consumer actually asks for it (k8s deployment, HTTP MCP transport, or
an in-process scheduler that needs remote observability).

Rationale:

- 1.1.0's stated non-goal is "HTTP transport and k8s-native probes
  are not in scope" (README §Non-goals, `docs/configuration.md`).
  Option C would contradict that without a matching use case.
- Option B is a strict superset of today's `tail -f /dev/null` — the
  `docker compose exec` usage stays identical. No consumer has to
  change anything.
- Option C can be layered on top of Option B later without a breaking
  change (add `--port` flag, keep stdio behavior). The reverse is
  harder (removing an HTTP port is a breaking change).

## Migration path — `tail -f /dev/null` → `memory serve`

Executed under P3-4b (Should for 1.1.0; may slip to 1.2.0 if scope
pressure hits):

1. Add `memory serve` to `src/cli/index.ts`:
   - Calls `runMigrations()` (errors tolerated — same semantics as
     `docker-entrypoint.sh` today).
   - Installs SIGTERM/SIGINT handlers that call `closeDb()` and exit 0.
   - Awaits a never-resolving promise (with a heartbeat tick for
     future timers; no user-visible output during steady state).
2. Update `Dockerfile`: `CMD ["memory", "serve"]`.
3. Update `docker-compose.yml`: drop the `command: tail -f /dev/null`
   override; the image default takes over.
4. Update `examples/laravel-sidecar/docker-compose.yml` the same way.
5. Update healthcheck to still use `memory health` (no change needed —
   the CLI call runs independent of the serve loop).
6. Document the transition in CHANGELOG with the migration: no
   consumer action required unless they pinned `command:`.

## Consequences

- Container operators see one supervised Node process — matches the
  mental model of "the agent-memory daemon".
- Adding in-process timers (e.g. periodic `memory run-invalidation`
  or `memory prune`) becomes a localized edit to `memory serve` —
  previously impossible without an external cron or separate service.
- No new network surface; no new env vars; no new RBAC.
- `memory mcp` (stdio server spawned per client) is unaffected.

## Non-goals for this ADR

- HTTP MCP transport (tracked as a non-goal in README; would be a
  future ADR-0003 with its own trade-off analysis).
- k8s-native readiness probes (see Option C — revisit if a consumer
  brings a concrete use case).
- In-process scheduler implementation — out of scope for 1.1.0.
  Once Option B lands, `memory serve` is the obvious host for it.

## References

- `agents/roadmaps/archive/improve-system.md` — P3-4a / P3-4b
- `docker-compose.yml`, `Dockerfile`, `docker-entrypoint.sh`
- Reviewer feedback on PR #3 (Claude, GPT) — archived in
  `agents/analysis/improve-system-phase0.md`
