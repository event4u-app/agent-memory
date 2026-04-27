# Operator cheat-sheet — Day 0 → Day 1

One-page sequence for the Phase 2 spike. Each step is the **shortest correct command**; the why and the alternatives live in [`README.md`](README.md) (full runbook), [`operator-setup.md`](operator-setup.md) (firewall / ACL / vault / GHCR), and [`tailscale-acl.json`](tailscale-acl.json) (ACL policy). Estimated wall-clock: **45 min Day 0 + 30 min Day 1**.

## Day 0 — prep work (no Hetzner spend yet)

Do these from your laptop. None of them cost money.

| # | Action | Done when |
|---|---|---|
| 0.1 | **GHCR package → public visibility.** Console → `event4u-app` → Packages → `agent-memory` → Settings → Change visibility → Public. | `curl -sI https://ghcr.io/v2/event4u-app/agent-memory/manifests/main` returns `200`. |
| 0.2 | **Tailscale ACL drafted.** Open [`tailscale-acl.json`](tailscale-acl.json), replace the placeholder emails with the real team list, keep open in a tab — you paste it in step 1.4. | Email list confirmed with the team. |
| 0.3 | **Vault items pre-created** (empty values, fill in step 1.4). Schema in [`operator-setup.md` §3](operator-setup.md#3--1password-vault-items): `team-memory/postgres`, `team-memory/mcp-bearer`. | Both items exist; ACLs grant the team read on `mcp-bearer`. |
| 0.4 | **Hetzner Cloud account** with billing + an SSH key uploaded. | `hcloud server list` works (or Console login). |
| 0.5 | **Tailscale account** on the team tailnet, SSO enabled (Google or GitHub). | You can log into the admin console. |

## Day 1 — provisioning sequence

Run these in order. Each step links to the section in [`README.md`](README.md) with full detail.

### 1.1 — Provision host (5 min) — [README §1](README.md#1--provision-the-host)

Hetzner Cloud → New Server: `CX22`, Ubuntu 24.04, location `fsn1`, name `memory-brain`, your SSH key. Note the public IP.

```bash
ssh root@<public-ip>
adduser memory --disabled-password && usermod -aG sudo memory
```

### 1.2 — Firewall (3 min) — [operator-setup §1](operator-setup.md#1--hetzner-cloud-firewall)

```bash
hcloud firewall create --name memory-brain-fw
hcloud firewall add-rule memory-brain-fw --direction in --protocol tcp --port 22  --source-ips 0.0.0.0/0 --source-ips ::/0
hcloud firewall add-rule memory-brain-fw --direction in --protocol udp --port 41641 --source-ips 0.0.0.0/0 --source-ips ::/0
hcloud firewall apply-to-resource memory-brain-fw --type server --server memory-brain
```

### 1.3 — Docker + Tailscale (5 min) — [README §3](README.md#3--install-docker--tailscale)

```bash
# on the host as root
curl -fsSL https://get.docker.com | sh
usermod -aG docker memory
curl -fsSL https://tailscale.com/install.sh | sh
tailscale up --ssh --hostname memory-brain --advertise-tags=tag:memory-host
tailscale ip -4    #  → record this 100.x.x.x as TAILNET_IP
```

### 1.4 — Tailscale ACL + secrets (5 min)

- Tailscale admin → **Access Controls** → paste your filled-in ACL from step 0.2 → Save.
- On the host, generate the two secrets and put them in the vault items from step 0.3:

  ```bash
  openssl rand -hex 32   # POSTGRES_PASSWORD       → 1Password "team-memory/postgres"
  openssl rand -hex 32   # MEMORY_MCP_AUTH_TOKEN   → 1Password "team-memory/mcp-bearer"
  ```

### 1.5 — Deploy stack (5 min) — [README §5](README.md#5--deploy-the-stack)

```bash
# on the host as the `memory` user
mkdir -p ~/agent-memory-deploy && cd ~/agent-memory-deploy
curl -fsSL https://raw.githubusercontent.com/event4u-app/agent-memory/main/deploy/team-memory/docker-compose.yml -o docker-compose.yml
curl -fsSL https://raw.githubusercontent.com/event4u-app/agent-memory/main/deploy/team-memory/.env.example -o .env
${EDITOR:-vi} .env       # paste POSTGRES_PASSWORD, MEMORY_MCP_AUTH_TOKEN, TAILNET_IP

docker compose pull
docker compose up -d
docker compose exec agent-memory memory health
#  → { "status": "ok", "features": [...] }
```

### 1.6 — Verify from your laptop (3 min) — [README §6](README.md#6--verify-from-another-machine)

From any tailnet-joined machine — laptop must be on the tailnet first:

```bash
export MEMORY_MCP_AUTH_TOKEN=$(op read 'op://Engineering/team-memory/mcp-bearer')
export MEMORY_HOST=memory-brain
curl -fsSL -H "Authorization: Bearer $MEMORY_MCP_AUTH_TOKEN" \
  "http://${MEMORY_HOST}:7078/sse" --max-time 2 | head -3
#  → SSE handshake, no 401, no timeout
```

Or run the consumer-side helper end-to-end:

```bash
scripts/team-memory-onboard.sh
#  → all 4 checks ✓
```

### 1.7 — Backup cron (2 min) — [README §7](README.md#7--backups)

Mount the Hetzner Storage Box at `/home/memory/backups`, then drop the cron file from [README §7](README.md#7--backups). Verify the next morning a `.sql.gz` exists.

## After Day 1 — start the spike clock

You are now in **Phase 2, Step 5**: run the brain for ≥ 5 working days, capture every operational papercut in [`agents/analysis/team-memory-spike-notes.md`](../../agents/analysis/team-memory-spike-notes.md). Day-by-day template is already in that file.

## If something goes wrong

| Symptom | Most likely cause | Fix |
|---|---|---|
| `docker compose pull` → `unauthorized` | GHCR step 0.1 missed | Set package public, retry. |
| `memory health` → connection refused | Postgres still starting | Wait 20 s, retry. Compose health-checks gate it. |
| Laptop curl times out | Tailnet ACL excludes laptop, or wrong tag | `tailscale status` on laptop; check ACL `team-memory-users` group. |
| Laptop curl returns `401` | Wrong bearer | Re-pull from 1Password; verify same value in host `.env`. |
| `memory propose` → `Insufficient evidence` | Using `--impact normal` from CLI without evidence | Use `--impact low` for synthetic entries; real entries come from ingestion scanners. |

## What this cheat-sheet does **not** cover

- **Migration of existing local DBs** — Phase 4 of the roadmap.
- **Monitoring + capacity planning** — Phase 5 Steps 2–3.
- **Bearer rotation** — quarterly, per [ADR-0005](../../agents/adrs/0005-team-memory-auth.md).
- **Offboarding flow** — [README operational notes](README.md#operational-notes).
