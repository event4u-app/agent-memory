# Integrating with `@event4u/agent-config`

`@event4u/agent-memory` and
[`@event4u/agent-config`](https://github.com/event4u-app/agent-config)
are two separate packages designed to combine. **Neither depends on
the other.** This document explains what each does, how they connect
when paired, and what you give up by using only one.

## What each package does

| Package | Concern |
|---|---|
| `@event4u/agent-config` | Agent **behaviour** — skills, rules, commands, guidelines, personas, slash-commands. Shared across every repo that installs it. |
| `@event4u/agent-memory` | Agent **persistence** — trust-scored, decaying memory for an individual project. MCP server + CLI + Postgres/pgvector. |

A useful analogy: `agent-config` is the **instruction manual** the
agent reads every session. `agent-memory` is the **notebook** the
agent keeps over months — what it learned, what it trusts, what
decayed.

## The division of labour

```
┌──────────────────────────────┐        ┌──────────────────────────────┐
│ @event4u/agent-config        │        │ @event4u/agent-memory        │
│ ─────────────────────────── │        │ ─────────────────────────── │
│ How the agent thinks and     │        │ What the agent remembers     │
│ which checks it runs         │        │ and for how long             │
│                              │        │                              │
│ • Skills (.augment/skills/)  │        │ • MCP server (stdio)         │
│ • Rules (.augment/rules/)    │──┐  ┌─▶│ • `memory` CLI (JSON out)    │
│ • Commands (.augment/cmds/)  │  │  │  │ • Postgres + pgvector        │
│ • Guidelines + governance    │  │  │  │ • Trust scoring + decay      │
└──────────────────────────────┘  │  │  └──────────────────────────────┘
                                  ▼  │
              Skills call `memory retrieve` / `memory propose`
              from within their procedures, using the CLI or
              the MCP tool surface.
```

`agent-config` skills may **invoke** `agent-memory` commands
(`memory retrieve …`, `memory propose …`) when they are present, but
they must also degrade gracefully when memory is absent — that is part
of the `agent-config` contract, not an `agent-memory` concern.

## How they connect

### 1. Hydration via `postinstall`

When you install this package (`@event4u/agent-memory`), its
`postinstall` script delegates to `agent-config`'s installer **if that
package is resolvable** in the same `node_modules`. The installer
hydrates `.augment/skills/`, `.augment/commands/`, `.augment/contexts/`
as symlinks into the vendored `agent-config` directory. Project-local
rule overrides (`.augment/rules/`) remain real files.

Relevant code:

- [`scripts/postinstall.sh`](../scripts/postinstall.sh) — defensive
  delegate; always exits 0 even if `agent-config` is absent.
- `node_modules/@event4u/agent-config/scripts/install.sh` — the actual
  hydration.

### 2. The retrieval contract (v1)

The only formal API boundary between the two is the retrieval contract.
`agent-config` skills speak to `agent-memory` through three shapes:

| Surface | Purpose | Schema |
|---|---|---|
| `retrieve()` | Query memory with progressive disclosure | [`retrieval-v1.schema.json`](../tests/fixtures/retrieval/retrieval-v1.schema.json) |
| `health()` | Feature flags + readiness | [`health-v1.schema.json`](../tests/fixtures/retrieval/health-v1.schema.json) |
| `propose()` / `promote()` / `deprecate()` | Ingestion + lifecycle | [`propose-v1`](../tests/fixtures/retrieval/propose-v1.schema.json) · [`promote-v1`](../tests/fixtures/retrieval/promote-v1.schema.json) · [`deprecate-v1`](../tests/fixtures/retrieval/deprecate-v1.schema.json) |

Every response carries `contract_version: 1`. The shape-drift gate
([`tests/contract/`](../tests/contract/)) fails CI if any of these
evolve without the [ADR-0003](../agents/adrs/0003-contract-version-bumps.md)
approval path.

## What you lose by using only one

**Only `agent-config`, no `agent-memory`:** skills still work; any
skill that would call `memory retrieve` degrades to "no prior context
available, proceed without it". Fine for greenfield; wasteful on
mature codebases where past decisions get re-derived on every session.

**Only `agent-memory`, no `agent-config`:** the MCP tool and CLI surface
are fully usable. You get persistence and retrieval, but none of the
shared skills/rules; your agent has to know *when* to call the memory
tools. This is the path for teams that bring their own agent
framework.

## Upgrade and compatibility

- The two packages version independently.
- `agent-memory`'s response shapes are locked by contract version; see
  [`CHANGELOG.md`](../CHANGELOG.md) and [`docs/compatibility-matrix.md`](compatibility-matrix.md)
  for which `agent-config` versions tested against which
  `agent-memory` versions.
- Breaking changes to the retrieval contract require a major bump
  of `agent-memory` and coordinated adoption in `agent-config` (ADR-0003).

## Pointers

- Working setup: [`examples/with-agent-config/`](../examples/with-agent-config/)
- Retrieval contract source of truth: [`src/retrieval/contract.ts`](../src/retrieval/contract.ts)
- Policy for contract evolution: [`agents/adrs/0003-contract-version-bumps.md`](../agents/adrs/0003-contract-version-bumps.md)
