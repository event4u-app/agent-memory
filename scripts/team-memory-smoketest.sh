#!/usr/bin/env bash
# Team-memory smoke test — reusable for both the local dry-run and the
# Phase 2 Hetzner spike. Exercises the four acceptance checks listed in
# agents/analysis/team-memory-spike-notes.md without depending on any
# specific host (works against a local Compose project or a remote
# tailnet-reachable brain).
#
# Usage:
#   scripts/team-memory-smoketest.sh                    # uses local Compose project team-memory-dryrun
#   COMPOSE_PROJECT=team-memory  scripts/team-memory-smoketest.sh
#   BRAIN_URL=http://memory-brain:7078  scripts/team-memory-smoketest.sh   # remote SSE checks only
#   MEMORY_MCP_AUTH_TOKEN=… scripts/team-memory-smoketest.sh
#
# Exit codes: 0 = all checks pass · 1 = one or more failed.

set -u

PROJECT="${COMPOSE_PROJECT:-team-memory-dryrun}"
BRAIN_URL="${BRAIN_URL:-http://127.0.0.1:7078}"
COMPOSE_FILE="${COMPOSE_FILE:-deploy/team-memory/docker-compose.yml}"
ENV_FILE="${ENV_FILE:-.tmp/dryrun/.env}"

step() { printf '\n[%s] %s\n' "$1" "$2"; }
ok()   { printf '  ✓ %s\n' "$1"; }
fail() { printf '  ✗ %s\n' "$1"; exit_code=1; }
exit_code=0

dc() { docker compose -p "$PROJECT" -f "$COMPOSE_FILE" --env-file "$ENV_FILE" "$@"; }

# Resolve bearer (env wins; otherwise read from .env file)
if [ -z "${MEMORY_MCP_AUTH_TOKEN:-}" ] && [ -f "$ENV_FILE" ]; then
	MEMORY_MCP_AUTH_TOKEN="$(grep -E '^MEMORY_MCP_AUTH_TOKEN=' "$ENV_FILE" | head -1 | cut -d= -f2-)"
fi
if [ -z "${MEMORY_MCP_AUTH_TOKEN:-}" ]; then
	printf 'MEMORY_MCP_AUTH_TOKEN not set and not found in %s — abort\n' "$ENV_FILE" >&2
	exit 2
fi

# 1 · SSE auth boundary --------------------------------------------------------
step 1 "SSE auth boundary"
code() { curl -sS --max-time 3 -o /dev/null -w "%{http_code}" "$@"; }
c200=$(code -H "Authorization: Bearer $MEMORY_MCP_AUTH_TOKEN" "$BRAIN_URL/sse" || true)
c401=$(code "$BRAIN_URL/sse")
c403=$(code -H "Authorization: Bearer wrong-token" "$BRAIN_URL/sse")
c404=$(code -H "Authorization: Bearer $MEMORY_MCP_AUTH_TOKEN" "$BRAIN_URL/random")
# `200` arrives mid-stream so curl times out (28) after the headers — both 200 and 000 are acceptable
case "$c200" in 200|000) ok "GET /sse with bearer → header arrived" ;; *) fail "GET /sse with bearer → $c200 (expected 200)" ;; esac
[ "$c401" = "401" ] && ok "GET /sse without bearer → 401" || fail "GET /sse without bearer → $c401"
[ "$c403" = "403" ] && ok "GET /sse with wrong bearer → 403" || fail "GET /sse with wrong bearer → $c403"
[ "$c404" = "404" ] && ok "GET /random → 404" || fail "GET /random → $c404"

# 2 · CLI round-trip via docker compose exec -----------------------------------
# Skip this section when running against a remote brain — the tailnet does not
# expose docker compose exec; the Hetzner operator runs this from the host.
if [ "$BRAIN_URL" = "http://127.0.0.1:7078" ]; then
	step 2 "Data plane round-trip (propose → promote → verify → retrieve candidate)"
	# `memory propose` (CLI) cannot attach evidence — only ingestion scanners
	# (git-reader, file-scanner, doc-reader) and `mcp.memory_ingest` from an
	# agent context can. So this synthetic entry uses --impact low (which has
	# MIN_EVIDENCE_COUNT=0) to clear the evidence floor at promotion. Trust
	# settles at 0.2 (no evidence ⇒ floor in scoring.ts), which is below both
	# the default (0.6) and low-trust (0.3) retrieval thresholds. The check
	# therefore validates: (a) the proposal lands; (b) promotion succeeds;
	# (c) `verify` finds the entry; (d) `retrieve` indexes it as a candidate
	# (totalCandidates >= 1) even though it filters it out. That is the full
	# data-plane round-trip the CLI can demonstrate without a real ingestion.
	id_json=$(dc exec -T agent-memory memory propose \
		--type architecture_decision \
		--title "Smoke test entry $(date +%s)" \
		--summary "Synthetic entry created by team-memory-smoketest.sh." \
		--repository "team-memory-smoketest" \
		--impact low \
		--knowledge-class volatile \
		--confidence 0.7 \
		--source "smoketest-$(date +%s)" \
		--gate-clean \
		--created-by "cli:smoketest" 2>/dev/null | grep -A1 '"proposal_id"')
	pid=$(printf '%s' "$id_json" | grep -oE '"proposal_id": "[a-f0-9-]+"' | head -1 | sed 's/.*"\([a-f0-9-]\{36\}\)".*/\1/')
	if [ -n "$pid" ]; then ok "propose → $pid"; else fail "propose returned no proposal_id"; printf '    raw: %s\n' "$id_json"; fi

	if [ -n "$pid" ]; then
		promote_out=$(dc exec -T agent-memory memory promote "$pid" 2>/dev/null | grep -A4 '"status"')
		if printf '%s' "$promote_out" | grep -q '"validated"'; then
			ok "promote → validated"
		else
			fail "promote did not produce validated status"; printf '    raw: %s\n' "$promote_out"
		fi

		verify_out=$(dc exec -T agent-memory memory verify "$pid" 2>/dev/null | grep -E '"id"|"status"' | head -2)
		if printf '%s' "$verify_out" | grep -q '"validated"'; then
			ok "verify reports validated"
		else
			fail "verify did not confirm validated status"; printf '    raw: %s\n' "$verify_out"
		fi

		# Retrieve confirms the entry is indexed as a candidate. The trust pipeline
		# filters CLI-only entries (no evidence ⇒ trust 0.2 < threshold 0.3) — that
		# is correct behaviour. `totalCandidates >= 1` proves search reached it.
		retrieve_out=$(dc exec -T agent-memory memory retrieve "smoke test entry" --type architecture_decision --limit 5 --low-trust 2>/dev/null | grep -A30 '"contract_version"')
		if printf '%s' "$retrieve_out" | grep -qE '"totalCandidates": *[1-9]'; then
			ok "retrieve indexes the entry as a candidate (filter by trust is expected for CLI-only entries)"
		else
			fail "retrieve did not see the entry as a candidate"; printf '    raw: %s\n' "$retrieve_out"
		fi
	fi

	step 3 "Health probe"
	health_out=$(dc exec -T agent-memory memory health 2>/dev/null | grep -E '"status"|"contract_version"')
	if printf '%s' "$health_out" | grep -q '"ok"'; then
		ok "memory health → status: ok"
	else
		fail "memory health did not return status: ok"; printf '    raw: %s\n' "$health_out"
	fi
else
	step 2 "Data plane round-trip skipped (BRAIN_URL is remote — run on the host instead)"
fi

# Summary ----------------------------------------------------------------------
printf '\n'
[ "$exit_code" -eq 0 ] && printf 'All smoke checks passed.\n' \
                       || printf 'One or more smoke checks failed (exit %s).\n' "$exit_code"
exit "$exit_code"
