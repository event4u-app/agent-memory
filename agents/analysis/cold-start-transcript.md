# Cold-start verification — P3-8 transcript

> **Run date:** 2026-04-23 · **Branch:** `feat/improve-system` @ 2c4bf3b
> **Scope:** P3-8 (Third-party cold-start) — pull the (unreleased)
> image, follow `docs/consumer-setup-generic.md`/`…-docker-sidecar.md`
> step by step, record every friction point.
> **Verdict:** Pass after fixes. Three blocker bugs found and resolved
> in this same branch.

## Environment

- Host: macOS (Apple Silicon), Docker via OrbStack
- Working dir: `/tmp/agent-memory-cold-start` (fresh, no repo access)
- Only artifact available: `docker-compose.yml` (copied from the branch
  to simulate what consumers will `curl` after merge to `main`)

## Findings

### F1 — Published GHCR image not yet available [expected, non-blocking]

`docker manifest inspect ghcr.io/event4u-app/agent-memory:latest`
returns `manifest unknown`. The publish workflow triggers on `main`
pushes and tags; the branch hasn't been merged. Mitigation: built the
image locally from the repo's `Dockerfile` to simulate the
post-release state. After v1.1.0 is tagged, a second cold-start run
by a third party can use the published image directly.

### F2 — Stale local image cache masked the real state [dev-only]

An older `ghcr.io/event4u-app/agent-memory:latest` was cached locally
(from dev builds pre-dating `memory serve`). Running compose without
rebuild picked up the stale image with `CMD ["memory", "mcp"]`, which
exited immediately because stdin had no client. **Documenting this so
the next runner remembers to `docker rmi` before rebuilding.** Not a
shipping defect.

### F3 — Docker CLI invocations exited silently (blocker, fixed)

**Symptom:** `memory migrate`, `memory health`, `memory status` inside
the container printed nothing on stdout or stderr and exited 0.
`memory serve` logged the startup banner, parsed nothing, exited 0.

**Root cause:** `src/cli/index.ts`, `src/db/migrate.ts`, and
`src/mcp/server.ts` all used the naive "main module" guard
`process.argv[1] === fileURLToPath(import.meta.url)`. The Docker image
exposes the CLI as `/usr/local/bin/memory → /app/dist/cli/index.js`.
Under that symlink, `argv[1]` is the symlink path while
`import.meta.url` resolves to the real file — guard returns false,
`program.parse()` never runs, process exits without work.

**Fix:** New helper `src/utils/is-main-module.ts` that resolves both
sides with `realpathSync`. All three call sites now use it. Added
`tests/unit/is-main-module.test.ts` with 5 cases (direct match,
symlink match, unrelated path, missing argv[1], non-existent path)
to prevent regression.

**Side effect:** caught a transitive bug — on macOS, `/tmp` is itself
a symlink (`/tmp → /private/tmp`). The helper resolves both argv[1]
and the module URL with `realpathSync`, so the fix handles nested
symlinks correctly.

### F4 — `memory serve` exited after startup (blocker, fixed)

**Symptom:** After the symlink fix, `memory serve` ran migrations,
logged `supervisor ready — awaiting SIGTERM`, then exited 0 within
~30 seconds. Container healthcheck flipped from healthy to exited.

**Root cause:** The supervisor parked on `await new Promise(() => {})`,
expecting that to hold the Node event loop. Node 20 detects the
unresolved top-level await and exits with a warning
`Detected unsettled top-level await`. `process.on("SIGTERM", …)`
handlers do not count as active handles — registering them alone does
not keep the loop alive.

**Fix:** Added `setInterval(() => {}, 1 << 30)` as an explicit keep-alive
handle, cleared on shutdown. When in-process timers land (ADR-0002
non-goal) this interval becomes the scheduler tick.

## Final cold-start walkthrough (passing)

```
$ cd /tmp/agent-memory-cold-start
$ cp <repo>/docker-compose.yml .        # simulates curl from main post-merge
$ docker compose up -d agent-memory
 Container …-postgres-1 Healthy
 Container …-agent-memory-1 Started

$ docker compose ps
…-agent-memory-1   Up 15 seconds (healthy)
…-postgres-1       Up 20 seconds (healthy)

$ docker compose exec -T agent-memory memory health | jq '{status,contract_version,latency_ms}'
{ "status": "ok", "contract_version": 1, "latency_ms": 13 }

$ docker compose exec -T agent-memory memory status
present

$ docker compose exec -T agent-memory memory propose --type bug_pattern \
    --title "Cold-start smoke test" --summary "…" \
    --repository smoke-test --source P3-8 --confidence 0.7 \
    --scenario cold-start-verification | jq '{status,proposal_id}'
{ "status": "quarantine", "proposal_id": "aa7d9fcd-…" }

$ docker compose exec -T agent-memory memory retrieve "invoice N+1" | jq '.entries | length'
0     # quarantined entry not served (expected; trust threshold gate)

# After 45s, container still healthy — supervisor holds the event loop.
$ docker compose down -v
```

## Doc deltas needed (tracked in roadmap, not blocking this PR)

- `docs/consumer-setup-docker-sidecar.md` §1 compose snippet updated
  to drop `command: [tail, -f, /dev/null]` (already shipped in
  2c4bf3b).
- `docs/consumer-setup-generic.md` line 69 counters (14 CLI, 23 MCP)
  now stale after `migrate` + `serve` were added — reflected in
  README (16 CLI commands). Follow-up: regenerate the mental-model
  block during the 1.1.0 doc sweep.

## Exit criteria

- [x] Fresh directory → `docker compose up` → container healthy.
- [x] `memory health` returns `status: ok` on clean stdout.
- [x] Propose → quarantine → retrieve round-trip works.
- [x] Container stays healthy past the first healthcheck cycle
      (verified through 45 s; no more drive-by exits).
- [ ] Second independent run by reviewer — pending PR review.

## Artifacts

- Fix commit: (follows this transcript)
- Regression test: `tests/unit/is-main-module.test.ts`
- Helper: `src/utils/is-main-module.ts`
- Serve keep-alive: `src/cli/index.ts` → `setInterval(…, 1 << 30)`
