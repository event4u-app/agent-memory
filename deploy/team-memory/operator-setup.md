# Operator setup — pieces that live outside `docker-compose.yml`

Three things the maintainer configures **once**, in addition to the Compose stack: the Hetzner Cloud Firewall, the Tailscale ACL, and the team's secret vault items. Each is an artefact the runbook ([`README.md`](README.md)) references.

## 1 · Hetzner Cloud Firewall

Attach to the `memory-brain` server. Inbound only `22/tcp` and `41641/udp` — everything else, including `7078`, must stay closed on the public IP. Tailscale carries the brain traffic on its own port.

### Hetzner Cloud Console (manual)

1. Console → **Firewalls** → **Create Firewall** → name `memory-brain-fw`.
2. Inbound rules:

   | Source | Protocol | Port | Reason |
   |---|---|---|---|
   | `0.0.0.0/0`, `::/0` | TCP | 22 | SSH (initial bootstrap; tighten to your office IP after Tailscale is up) |
   | `0.0.0.0/0`, `::/0` | UDP | 41641 | Tailscale DERP / direct |

3. Outbound: leave default (allow all) — the host needs to pull Docker images and call `pgvector` updates.
4. **Apply to resource** → select `memory-brain`.

### `hcloud` CLI (reproducible)

```bash
hcloud firewall create --name memory-brain-fw
hcloud firewall add-rule memory-brain-fw \
	--direction in --protocol tcp --port 22 \
	--source-ips 0.0.0.0/0 --source-ips ::/0
hcloud firewall add-rule memory-brain-fw \
	--direction in --protocol udp --port 41641 \
	--source-ips 0.0.0.0/0 --source-ips ::/0
hcloud firewall apply-to-resource memory-brain-fw \
	--type server --server memory-brain
```

After Tailscale SSH (ADR-0005) is verified, drop the public-IP SSH rule entirely:

```bash
hcloud firewall delete-rule memory-brain-fw \
	--direction in --protocol tcp --port 22 \
	--source-ips 0.0.0.0/0 --source-ips ::/0
```

From that point all administrative access is via `tailscale ssh root@memory-brain`. The host has no listening TCP service exposed to the public internet.

## 2 · Tailscale ACL

Source-of-truth: [`tailscale-acl.json`](tailscale-acl.json). Paste it into the Tailscale admin console (Access Controls tab), replacing the placeholder emails with the real team list.

| Element | Value |
|---|---|
| Tag | `tag:memory-host` (applied to the Hetzner host via `tailscale up --advertise-tags=tag:memory-host`) |
| Tag owners | `group:admin` (only admins may apply this tag) |
| Allowed sources to `tag:memory-host:7078` | `group:team-memory-users`, `group:admin` |
| SSH access | `group:admin` → `root` / `memory` on `tag:memory-host` |
| Tests | non-members denied; team-memory users blocked from SSH |

The Tailscale "Tests" stanza is a regression net — every ACL edit re-runs them. Keep at least the two listed tests; add per-developer tests as the team grows.

**Offboarding (ADR-0005 §4):** remove the leaver from `group:team-memory-users`, then rotate the bearer (next section). The Tailscale removal blocks network reach instantly; the bearer rotation closes the brief window where a cached `MEMORY_MCP_AUTH_TOKEN` could still authenticate from a personal device that has not yet been removed from the SSO account.

## 3 · 1Password vault items

Two items, both stored in the team's `Engineering` vault. Reference paths match the defaults baked into [`scripts/team-memory-onboard.sh`](../../scripts/team-memory-onboard.sh) and the deploy README.

### `op://Engineering/team-memory/postgres`

| Field | Value |
|---|---|
| Type | Password |
| Value | `openssl rand -hex 32` output, generated at provisioning time |
| Distribution | **Maintainer-only.** Developers never see this — only the brain host and database backups touch it. |
| Rotation | On host re-provision, on suspected leak. Not on a schedule. Rotation requires `docker compose down`, edit `.env`, `docker compose up -d` plus a re-encrypt of the pgvector volume. |

### `op://Engineering/team-memory/mcp-bearer`

| Field | Value |
|---|---|
| Type | Password |
| Value | `openssl rand -hex 32` output |
| Distribution | **All `team-memory-users`.** Read-access in 1Password is the gate — there is no per-user bearer. |
| Rotation | **Quarterly** per ADR-0005, plus immediately after any developer offboarding. Procedure: generate new value → update `.env` on the brain host → `docker compose up -d agent-memory` → publish to vault → developers re-run `scripts/team-memory-onboard.sh`. |
| Recovery | Lost / forgotten: pull from 1Password again. The token does not appear in any developer's git history or local file (the onboarding script never writes it to disk). |

### Other vault tools (Bitwarden, Vault, Doppler)

The schema is identical — two secrets, one maintainer-only, one read-shared with the team. Replace `op read 'op://...'` calls with the equivalent CLI:

| Tool | Read command |
|---|---|
| 1Password CLI | `op read 'op://Engineering/team-memory/mcp-bearer'` |
| Bitwarden CLI | `bw get password team-memory-mcp-bearer` |
| HashiCorp Vault | `vault kv get -field=value secret/team-memory/mcp-bearer` |
| Doppler | `doppler secrets get TEAM_MEMORY_MCP_BEARER --plain` |

Override the default 1Password reference via `MEMORY_BEARER_OP_REF` (consumed by [`scripts/team-memory-onboard.sh`](../../scripts/team-memory-onboard.sh)).
