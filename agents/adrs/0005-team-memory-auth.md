# ADR-0005: Team memory auth model

> **Status:** Proposed
> **Date:** 2026-04-27
> **Roadmap:** `agents/roadmaps/team-memory-deployment.md` (Phase 1, Step 2)
> **Related:** ADR-0004 (hosting), `docs/mcp-http.md`, `docs/secret-safety.md`.

## Context

Once the team-memory instance is hosted (ADR-0004), every developer's
machine, plus CI, must reach it to call `memory retrieve`, `memory
propose`, `memory promote`, and the MCP tool surface. The decision is
*how* that connection is authenticated and what the network surface
looks like.

Constraints carried in from the roadmap:

- **Privacy boundary is the promotion gate, not the network.**
  Quarantined entries stay invisible to retrieval until `memory
  promote` runs (ADR-0001 Decision 9). The auth model only needs to
  prevent unauthorized *connections* — it is not the access-control
  layer for entry visibility.
- **Rotation policy:** credentials must be rotatable per developer
  without re-issuing for the whole team.
- **Offboarding path:** when a dev leaves, their access must be
  revocable in minutes, not hours.
- **CI compatibility:** `memory doctor` runs in `task ci` for every
  consumer repo (roadmap Phase 3, Step 4). The auth model must work
  from CI runners without a human in the loop.
- **Transport:** the package exposes `memory mcp` (stdio) and
  `memory serve --mcp-http` (HTTP). The HTTP path is the only one
  that can cross the network without an intermediate tunnel.

## Options considered

### Option A — Tailscale VPN (WireGuard mesh)

Each developer machine and the host running `memory serve` join a
Tailscale tailnet. The MCP HTTP endpoint listens on the tailnet
address only; from the internet it is unreachable. ACLs in Tailscale
restrict who can reach the memory node.

- ✅ Zero-config for developers — `tailscale up` and they're in.
- ✅ Free tier covers ≤ 100 devices, well above team size.
- ✅ SSO (Google / GitHub / Okta) handles offboarding — remove the
  user from the SSO group, their device key dies.
- ✅ No public network surface; reduces attack surface to "is
  Tailscale itself compromised".
- ❌ CI runners on GitHub-hosted infrastructure are awkward — needs
  Tailscale GitHub Action with an OAuth client + ephemeral key.
  Workable but non-trivial.
- ❌ Adds a hard dependency on Tailscale availability for *every*
  agent retrieval call.

### Option B — Cloudflare Tunnel + mTLS (or Cloudflare Access)

The memory host runs `cloudflared` and exposes the MCP HTTP endpoint
through a Cloudflare Tunnel. Cloudflare Access enforces mTLS or SSO
in front of it. Public DNS, but no inbound port; only authenticated
clients reach the origin.

- ✅ Public hostname, no VPN client on dev machines (browser SSO is
  enough for first-time setup).
- ✅ CI integration via service tokens — first-class workflow.
- ✅ Free tier of Cloudflare Access covers ≤ 50 users.
- ❌ Every developer needs a client cert installed (mTLS) or a SSO
  cookie refresh (Access) — more moving parts than a VPN.
- ❌ Cloudflare becomes a hard dependency on the agent's hot path.
- ❌ Cert rotation is a separate concern (CA, expiry monitoring).

### Option C — Public endpoint + per-developer `MCP_AUTH_TOKEN`

The MCP HTTP endpoint is public on the chosen host. Each developer
(and each CI runner) holds a long-lived bearer token in the
`MCP_AUTH_TOKEN` env var; the server validates it against a
per-token allow-list. Tokens are issued from a scripted vault
(1Password, Bitwarden, AWS Secrets Manager — TBD).

- ✅ Simplest network topology — one public hostname, one header.
- ✅ Trivially CI-compatible — set the secret in GitHub Actions,
  done.
- ✅ Token rotation is per-developer; revoke = remove from allow-list.
- ❌ Public attack surface. Token leak = full read+propose access
  until rotation. Requires rate limiting + audit log on the server
  side.
- ❌ The package does not currently have a built-in token store or
  allow-list — would need a small implementation effort (or a
  reverse-proxy with HTTP basic / bearer auth in front).
- ❌ Long-lived tokens are explicitly called out as a smell in
  `docs/secret-safety.md`.

## Decision

**Open.** Resolve during Phase 1, Step 2 of
`agents/roadmaps/team-memory-deployment.md`. The decision must record:

- Chosen option (A / B / C) and reasoning.
- **Rotation policy:** how often, who triggers, where the new
  credential is delivered.
- **Offboarding runbook:** the exact steps to revoke a departing
  developer's access (covers Phase 5, Step 4).
- **CI integration path:** how the auth credential reaches a GitHub
  Actions runner without leaking into logs.
- **Failure mode:** what happens to agent retrieval if the auth
  layer is unavailable (degraded mode? hard fail? local cache?).
- **Audit log:** where authenticated requests are recorded and how
  long they are retained.

## Consequences (to be filled when decision is made)

To be written when status flips from `Proposed` to `Accepted`.

## Non-goals

- Per-entry ACLs beyond the existing trust/quarantine boundary —
  out of scope per roadmap.
- End-user-facing auth (no UI in scope for V1).
- Multi-team isolation — single-team brain only.
- Encryption at rest beyond what the hosting provider gives us by
  default — revisit only if the data sensitivity policy in
  `docs/secret-safety.md` flips.

## References

- `agents/roadmaps/team-memory-deployment.md` — Phase 1, Step 2;
  Phase 5, Step 4 (offboarding runbook)
- ADR-0004 — hosting (this ADR's network constraints depend on it)
- `docs/mcp-http.md` — current HTTP transport documentation
- `docs/secret-safety.md` — credential-handling policy floor
