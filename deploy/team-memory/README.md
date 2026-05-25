# Team-memory deployment runbook

End-to-end steps to bring up the shared `agent-memory` brain on a Hetzner CX22 with Tailscale-only network access. Implements the decisions in [ADR-0004](../../agents/adrs/0004-team-memory-hosting.md), [ADR-0005](../../agents/adrs/0005-team-memory-auth.md), [ADR-0006](../../agents/adrs/0006-team-memory-scope-policy.md).

> **Status:** ready for Phase 2 spike. Real provisioning is **not** automated yet — the steps below are run by a maintainer once. Cost: ≈ €8.82/month.
>
> **In a hurry?** [`operator-cheatsheet.md`](operator-cheatsheet.md) condenses the same flow into a Day-0 / Day-1 sequence with one command per step.

## Prerequisites

- Hetzner Cloud account with billing.
- Tailscale account on the team's tailnet, with SSO (Google or GitHub) configured.
- Team password vault (1Password, Bitwarden, …) for distributing the bearer token.
- Local `hcloud` CLI (optional) and `ssh`.

## 1 · Provision the host

Hetzner Cloud Console → New Server:

- **Location:** `fsn1` (Falkenstein) or `nbg1` (Nuremberg) — both EU-Germany.
- **Image:** Ubuntu 24.04 LTS.
- **Type:** **CX22** (2 vCPU, 4 GB RAM, 40 GB SSD).
- **Networking:** IPv4 + IPv6 (we will close it down with Tailscale + UFW).
- **SSH key:** add the maintainer's key.
- **Name:** `memory-brain`.

After boot, SSH in:

```bash
ssh root@<public-ip>
adduser memory --disabled-password
usermod -aG sudo,docker memory   # docker group only after step 3
```

## 2 · Lock down the firewall

Hetzner Cloud Console → Firewalls → attach a firewall to the host that allows **inbound only**: `22/tcp` (SSH) and `41641/udp` (Tailscale). Full configuration (Console click-path + reproducible `hcloud` CLI commands) lives in [`operator-setup.md` §1](operator-setup.md#1--hetzner-cloud-firewall).

```bash
# Optional second layer on the host itself:
ufw allow 22/tcp
ufw allow 41641/udp
ufw enable
```

## 3 · Install Docker + Tailscale

```bash
# Docker (Compose v2 included)
curl -fsSL https://get.docker.com | sh
usermod -aG docker memory

# Tailscale
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up --ssh --hostname memory-brain --advertise-tags=tag:memory-host
sudo tailscale ip -4
#  → 100.x.x.x  ← record this; it is the TAILNET_IP for .env
```

In the Tailscale admin console (Access Controls tab), paste the ACL from [`tailscale-acl.json`](tailscale-acl.json) and replace the placeholder emails with the team list. The ACL grants `team-memory-users` access to `tag:memory-host:7078` only, plus admin SSH on port 22; full reasoning in [`operator-setup.md` §2](operator-setup.md#2--tailscale-acl).

## 4 · Generate secrets

```bash
# As the `memory` user, in /home/memory/agent-memory-deploy
openssl rand -hex 32   # POSTGRES_PASSWORD       → store in vault
openssl rand -hex 32   # MEMORY_MCP_AUTH_TOKEN   → store in vault
```

Store both in the team vault under `team-memory/postgres` and `team-memory/mcp-bearer`. The bearer is distributed to every developer; the Postgres password stays maintainer-only. Vault item schema (1Password / Bitwarden / Vault / Doppler equivalents): [`operator-setup.md` §3](operator-setup.md#3--1password-vault-items).

## 5 · Deploy the stack

> **One-time prerequisite:** the GHCR package `ghcr.io/event4u-app/agent-memory` must be set to **public visibility** before `docker compose pull` can fetch images anonymously. See [`operator-setup.md` §4](operator-setup.md#4--ghcr-package-visibility-one-time). The default `MEMORY_IMAGE_TAG=main` tracks the newest main-branch build; for production pin to `sha-<short>` (reproducibility) or `v1.x.y` once a release ships — `:latest` is reserved for release tags and does not exist yet.

```bash
# On the host, as the `memory` user:
mkdir -p ~/agent-memory-deploy && cd ~/agent-memory-deploy
curl -fsSL https://raw.githubusercontent.com/event4u-app/agent-memory/main/deploy/team-memory/docker-compose.yml -o docker-compose.yml
curl -fsSL https://raw.githubusercontent.com/event4u-app/agent-memory/main/deploy/team-memory/.env.example -o .env
${EDITOR:-vi} .env       # paste secrets + TAILNET_IP

docker compose pull
docker compose up -d
docker compose ps        # both services healthy after ~30s
docker compose exec agent-memory memory health
#  → { "status": "ok", "features": [...] }
```

## 6 · Verify from another machine

From any tailnet-joined developer machine:

```bash
export MEMORY_MCP_AUTH_TOKEN=<bearer from vault>
export MEMORY_HOST=memory-brain   # tailnet hostname
curl -fsSL -H "Authorization: Bearer $MEMORY_MCP_AUTH_TOKEN" \
  "http://${MEMORY_HOST}:7078/sse" --max-time 2 | head -3
#  → 200 OK + initial SSE handshake
```

If the curl times out instead of connecting, the tailnet ACL is misconfigured. If it returns `401`, the bearer is wrong.

## 7 · Backups

Add a host-side cron job (as `memory` user):

```cron
# /etc/cron.d/team-memory-backup
0 3 * * *  memory  cd /home/memory/agent-memory-deploy && \
  docker compose exec -T postgres \
    pg_dump -U memory -Fc agent_memory \
  | gzip > /home/memory/backups/agent_memory-$(date +\%Y\%m\%d).sql.gz \
  && find /home/memory/backups -name 'agent_memory-*.sql.gz' -mtime +30 -delete
```

Mount a Hetzner Storage Box (BX11, ~€2.99/mo, 1 TB) at `/home/memory/backups`. Setup follows the official Hetzner docs — out of scope here. RPO is ≤ 24h (the last nightly dump). RTO is measured during the Phase 5 Step 1 restore drill.

## 8 · Restore drill (Phase 5 Step 1)

Required before declaring Phase 5 done. Procedure:

```bash
# On a fresh host or a temporary Compose stack:
docker compose up -d postgres
gunzip -c agent_memory-YYYYMMDD.sql.gz \
  | docker compose exec -T postgres pg_restore -U memory -d agent_memory --clean --if-exists
docker compose up -d agent-memory
docker compose exec agent-memory memory health
#  → { "status": "ok", ... }
```

Record start-to-`status: ok` time in `agents/analysis/team-memory-spike-notes.md`. Target: ≤ 30 min.

## 9 · Connect a consumer repo

After the spike confirms the brain is reachable, follow [`docs/consumer-setup-docker-sidecar.md`](../../docs/consumer-setup-docker-sidecar.md#team-memory-remote-mode) — section "Team-memory remote mode" (added in Phase 3 Step 1). The short version: drop the local `postgres` + `agent-memory` services, point your MCP client at `http://memory-brain:7078/sse` with the shared bearer, omit `repository:` from `.agent-memory.yml`.

## Operational notes

- **Image updates:** `docker compose pull && docker compose up -d` on the host. Pin `MEMORY_IMAGE_TAG` in `.env` for production; `latest` is fine for the spike.
- **Bearer rotation (quarterly per ADR-0005):** generate a new token, update `.env`, `docker compose up -d agent-memory`, distribute via the vault, ask developers to refresh.
- **Offboarding:** see [Phase 5 Step 4 in the roadmap](../../agents/roadmaps/team-memory-deployment.md). One-line summary: remove from Tailscale group → re-deploy with a fresh bearer.
- **Logs:** `docker compose logs --tail 200 agent-memory`. Structured JSON via Pino — pipe into the team's log destination once Phase 5 Step 2 chooses one.
