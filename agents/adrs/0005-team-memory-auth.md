# ADR-0005: Team memory auth model

> **Status:** Accepted
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

**Option A — Tailscale VPN, layered with the existing `MEMORY_MCP_AUTH_TOKEN` bearer (defense in depth).**

The package already mandates `MEMORY_MCP_AUTH_TOKEN` for the SSE transport (`docs/mcp-http.md`) — the server refuses to start without one. That bearer stays. Tailscale is the network gate in front of it: the SSE listener binds to the tailnet interface only; the public internet sees nothing.

| Field | Value |
|---|---|
| Network gate | Tailscale tailnet (free tier, ≤ 100 devices). Host runs the `tailscale/tailscale` sidecar; SSE binds to the `100.x.x.x` (tailnet) address only. No public DNS, no inbound port. |
| Application auth | Existing `MEMORY_MCP_AUTH_TOKEN` (32-byte hex), set at deploy, distributed to developers via the team's password manager (1Password / Bitwarden — chosen by the maintainer at provisioning time). |
| Rotation policy | Bearer token rotated **quarterly** by re-deploying the host with a fresh token; new value distributed via the team's vault. Tailscale device keys auto-rotate every 180 days. CI ephemeral keys regenerate per workflow run via the Tailscale OAuth client. |
| Offboarding | (1) Remove dev from the Tailscale SSO group → device key invalid within minutes. (2) Re-deploy host with a fresh bearer. (3) Confirm via `tailscale status` on the host. Captured end-to-end in the Phase 5 Step 4 runbook. |
| CI integration | `tailscale/github-action@v3` with OAuth client + ephemeral auth key (no long-lived secret in CI). Bearer token from GitHub Secrets. `memory doctor` runs as a workflow step; failure fails CI fast. |
| Failure mode | If the tailnet is unreachable, retrieval **hard-fails** (`memory retrieve` returns empty + logs a warning). No local cache fallback in V1 — agents fall back to live code analysis. Documented in `docs/operations.md` extension. |
| Audit log | Tailscale's own audit log + the SSE listener's structured request log (Pino) shipped to the team's chosen log destination (Phase 5 Step 2). 30-day retention. |

### Why not the others

- **Option B (Cloudflare Tunnel + mTLS)** rejected on hot-path dependency: Cloudflare Access in front of every retrieval adds a third-party uptime dependency and per-cert rotation overhead. Tailscale's free tier already covers SSO offboarding without managing certificates.
- **Option C (public + token only)** rejected because long-lived bearer tokens are explicitly called out as a smell in `docs/secret-safety.md`. With Tailscale layered in front, the same bearer is acceptable because the network attack surface is removed before authentication is even attempted.

## Consequences

- **Two layers of credential.** Developers need both a Tailscale identity (SSO via Google/GitHub) and the shared bearer token. The onboarding script (Phase 3 Step 2) checks both.
- **No public DNS for the brain.** Only a tailnet hostname (e.g. `memory-brain.tail-scale.ts.net`). Document the tailnet name once provisioned, in `deploy/team-memory/README.md`.
- **Tailscale is on the hot path.** Tailscale outage = retrieval outage. Mitigated by Tailscale's uptime track record (>99.9%) and the agent's hard-fail mode (no memory ≠ broken agent).
- **Phase 5 Step 4 runbook is the source of truth for offboarding.** When a dev leaves: SSO group removal, bearer rotation, runbook walked end-to-end and confirmed.

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
