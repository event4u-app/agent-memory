#!/usr/bin/env bash
# Team-memory onboarding helper.
#
# Walks a developer through the four checks needed to talk to the shared
# brain. Read-only by default — never edits shell rc files, never writes
# secrets to disk. Prints copy-pasteable export commands at the end.
#
# Implements Phase 3 Step 2 of agents/roadmaps/team-memory-deployment.md.
# Companion to deploy/team-memory/README.md (host-side runbook) and
# docs/consumer-setup-docker-sidecar.md §4 (consumer-side reference).
#
# Usage:
#   scripts/team-memory-onboard.sh                # all checks
#   scripts/team-memory-onboard.sh --skip-bearer  # skip 1Password lookup
#   scripts/team-memory-onboard.sh --help

set -u

BRAIN_HOST="${MEMORY_BRAIN_HOST:-memory-brain}"
BRAIN_PORT="${MEMORY_BRAIN_PORT:-7078}"
OP_REF="${MEMORY_BEARER_OP_REF:-op://Engineering/team-memory/mcp-bearer}"

skip_bearer=false
for arg in "$@"; do
	case "$arg" in
		--skip-bearer) skip_bearer=true ;;
		--help|-h)
			sed -n '2,15p' "$0" | sed 's/^# \{0,1\}//'
			exit 0 ;;
		*) printf 'unknown flag: %s (try --help)\n' "$arg" >&2; exit 2 ;;
	esac
done

step() { printf '\n[%s] %s\n' "$1" "$2"; }
ok()   { printf '  ✓ %s\n' "$1"; }
warn() { printf '  ⚠  %s\n' "$1"; }
fail() { printf '  ✗ %s\n' "$1"; exit_code=1; }

exit_code=0

# 1 · Tailscale ----------------------------------------------------------------
step 1 "Tailscale"
if ! command -v tailscale >/dev/null 2>&1; then
	fail "tailscale CLI not found — install from https://tailscale.com/download"
elif ! tailscale status >/dev/null 2>&1; then
	fail "tailscale not running — run: sudo tailscale up"
else
	ts_self="$(tailscale status --self=true --peers=false --json 2>/dev/null \
		| grep -oE '"DNSName":"[^"]+"' | head -1 | sed 's/.*:"//;s/"$//')"
	if [ -n "$ts_self" ]; then
		ok "tailnet up — this host: ${ts_self%.}"
	else
		ok "tailnet up"
	fi
fi

# 2 · DNS to the brain ---------------------------------------------------------
step 2 "Brain DNS resolution"
if ! getent hosts "$BRAIN_HOST" >/dev/null 2>&1 \
	&& ! host "$BRAIN_HOST" >/dev/null 2>&1 \
	&& ! ping -c1 -W1 "$BRAIN_HOST" >/dev/null 2>&1; then
	fail "$BRAIN_HOST does not resolve — ACL may exclude this device, or hostname differs"
	warn "override with: MEMORY_BRAIN_HOST=<hostname> $0"
else
	ok "$BRAIN_HOST resolves over the tailnet"
fi

# 3 · Bearer token -------------------------------------------------------------
step 3 "MCP bearer token"
bearer=""
if [ "$skip_bearer" = "true" ]; then
	warn "skipped (--skip-bearer)"
elif [ -n "${MEMORY_MCP_AUTH_TOKEN:-}" ]; then
	ok "MEMORY_MCP_AUTH_TOKEN already set in environment"
	bearer="$MEMORY_MCP_AUTH_TOKEN"
elif command -v op >/dev/null 2>&1; then
	if bearer="$(op read "$OP_REF" 2>/dev/null)" && [ -n "$bearer" ]; then
		ok "fetched bearer from 1Password ($OP_REF)"
	else
		fail "1Password CLI did not return a value for $OP_REF"
		warn "verify the item path; sign in with: op signin"
	fi
else
	warn "1Password CLI (op) not installed — fetch bearer manually from the team vault"
	warn "ref: $OP_REF"
fi

# 4 · SSE handshake ------------------------------------------------------------
step 4 "SSE handshake"
if [ -z "$bearer" ]; then
	warn "skipped (no bearer available)"
else
	url="http://${BRAIN_HOST}:${BRAIN_PORT}/sse"
	body="$(curl -fsS --max-time 3 \
		-H "Authorization: Bearer $bearer" \
		"$url" 2>&1 | head -3 || true)"
	if printf '%s' "$body" | grep -q "endpoint"; then
		ok "$url responded with SSE endpoint header"
	elif printf '%s' "$body" | grep -q "401"; then
		fail "401 Unauthorized — bearer is wrong or rotated"
	else
		fail "no SSE handshake from $url"
		printf '    raw: %s\n' "$(printf '%s' "$body" | tr '\n' ' ')"
	fi
fi

# Summary ----------------------------------------------------------------------
printf '\n'
if [ "$exit_code" -eq 0 ]; then
	printf 'All checks passed. Add to your shell rc to make the bearer available\n'
	printf 'to MCP clients (Claude Desktop, Cursor, Cline, Augment):\n\n'
	printf '  export MEMORY_BRAIN_URL="http://%s:%s"\n' "$BRAIN_HOST" "$BRAIN_PORT"
	printf '  export MEMORY_MCP_AUTH_TOKEN="$(op read \047%s\047)"\n\n' "$OP_REF"
	printf 'Then configure your MCP client per\n'
	printf 'docs/consumer-setup-docker-sidecar.md §4.\n'
else
	printf 'One or more checks failed. Fix the issues above and re-run.\n'
	printf 'Reference: docs/consumer-setup-docker-sidecar.md §4 (Team-memory remote mode).\n'
fi

exit "$exit_code"
