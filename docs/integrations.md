# Integrations

Wiring `@event4u/agent-memory` into the editors, CI systems, and runtime
stacks teams actually use. This page is the **single entry point** —
the repository README and individual docs link here, not directly to
a specific integration. That avoids the usual drift where snippets on
the landing page slowly diverge from the ones in `examples/`.

Every integration listed as **Available** lives in
[`examples/integrations/`](../examples/integrations/) and is smoke-tested
on every pull request by
[`.github/workflows/integrations.yml`](../.github/workflows/integrations.yml).
A change that breaks a copy-paste path turns CI red before it ships.

> `agent-memory` does not ship an installer or language-specific package.
> Every integration is a copy-paste template you adapt to your repo —
> pin versions, read the README, think about your deployment.

## Status matrix

| Integration | Transport | Status | Backing |
|---|---|---|---|
| [claude-desktop](../examples/integrations/claude-desktop/) | MCP stdio | ✅ Available | config template + `jq`-shape smoke + `memory --version` check |
| cursor | MCP stdio | 🚧 Planned | — |
| [github-actions](../examples/integrations/github-actions/) | CLI | ✅ Available | workflow template + static smoke that verifies every referenced `memory <subcommand>` against the live CLI |
| docker-sidecar-laravel | HTTP + CLI exec | 🚧 Planned | [`examples/laravel-sidecar/`](../examples/laravel-sidecar/) (compose + `php-demo.php` already usable standalone) |
| docker-sidecar-django | HTTP | 🚧 Planned | — |

Roadmap anchor: [`agents/roadmaps/runtime-trust.md`](../agents/roadmaps/runtime-trust.md)
§ D2. Target: at least five integrations available, with
Laravel/PHP **and** Django/Python both represented to prove stack
neutrality. Two more slots (`vscode-continue`, `gitlab-ci`) are tracked
in the roadmap but not promised on this page until they ship.

## Contributing a new integration

1. Create `examples/integrations/<name>/` with `README.md` and an
   executable `smoke.sh`. The smoke script must exit 0 on success and
   non-zero on failure — no "trust me" integrations.
2. Keep the README shape consistent: **What** · **When to use** ·
   **Copy-paste** · **Smoke check**.
3. No CI edit is required — the workflow discovers integrations by
   scanning for `smoke.sh`. The directory shape is also validated:
   every subdir must ship both `README.md` and `smoke.sh`, or the
   `discover` job fails loud.
4. Move the row in the status matrix above from 🚧 Planned to
   ✅ Available and link to the new directory.
5. If the integration covers a new stack (different language, new
   deploy target), note it in the roadmap entry so the stack-neutrality
   claim stays verifiable.

## Related docs

- [`consumer-setup-docker-sidecar.md`](consumer-setup-docker-sidecar.md)
  — generic sidecar setup, referenced by the Docker-based integrations.
- [`consumer-setup-node.md`](consumer-setup-node.md) — embedding
  `agent-memory` into a Node project directly.
- [`consumer-setup-generic.md`](consumer-setup-generic.md) — stack-
  agnostic setup for teams that want to wire it themselves.
- [`mcp-http.md`](mcp-http.md) — MCP over HTTP/SSE transport details,
  relevant for the editor integrations.
- [`compatibility-matrix.md`](compatibility-matrix.md) — which consumer
  versions work with which `agent-memory` versions.
