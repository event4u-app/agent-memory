# Example — `agent-config` + `agent-memory` together

Minimal runnable project that pairs
[`@event4u/agent-config`](https://github.com/event4u-app/agent-config)
(behaviour) with `@event4u/agent-memory` (persistence). This is the
companion example to
[`docs/integration-agent-config.md`](../../docs/integration-agent-config.md).

Neither package depends on the other — this example just shows the
expected combined layout and verifies both pieces resolve at the same
time.

## What you get

After `docker compose up -d` and `npm install`:

- `.augment/skills/`, `.augment/commands/`, `.augment/contexts/` are
  symlinked into `node_modules/@event4u/agent-config/...` — the
  behaviour layer is hydrated.
- `memory health` succeeds inside the `agent-memory` container — the
  persistence layer is live.
- An agent pointed at both surfaces (MCP stdio + filesystem skills)
  can read instructions from `agent-config` and call
  `memory retrieve` / `memory propose` from `agent-memory` in the
  same session.

## 3-step setup

```bash
# 1. From this directory
cp .env.example .env 2>/dev/null || true

# 2. Install npm deps — triggers both postinstalls
npm install

# 3. Boot the stack
docker compose up -d

# 4. Smoke test both pieces
./smoke-test.sh
```

Expected output from `smoke-test.sh`:

```
✅  agent-config: .augment/skills/ hydrated (N symlinks)
✅  agent-memory: memory health returned status=ok
✅  combined: retrieval contract version = 1
```

## File layout

| File | Purpose |
|---|---|
| `package.json` | Depends on both packages; npm runs each `postinstall`. |
| `docker-compose.yml` | Postgres (pgvector) + `agent-memory` sidecar. |
| `smoke-test.sh` | Verifies hydration + health + contract version. |
| `.env.example` | Database URL + log level; copy to `.env`. |

## Why this matters

Consumers reading
[`docs/integration-agent-config.md`](../../docs/integration-agent-config.md)
will ask "show me one working setup". This is that setup — the
smallest possible yes/no answer to *does it actually work?*.

If `smoke-test.sh` fails, one of the integration points regressed —
most likely the `postinstall` delegate in `agent-memory` or the
install script in `agent-config`. Both are linked from the integration
doc's **How they connect** section.
