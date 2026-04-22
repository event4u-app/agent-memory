#!/usr/bin/env bash
# Reproducible driver for the 60-second agent-memory setup demo.
#
# This script is designed to be executed INSIDE `asciinema rec` so the
# resulting cast is deterministic. It does three things, with pauses
# calibrated for human readability:
#
#   1. `docker compose up -d agent-memory` (pgvector + sidecar)
#   2. `memory doctor` (pretty health report on stderr)
#   3. `memory retrieve` (a real query against a seeded entry)
#
# Total target runtime: ~40 seconds.
#
# Usage (contributor):
#   asciinema rec --command "./docs/media/record-demo.sh" docs/media/demo.cast
#   asciinema upload docs/media/demo.cast        # optional: get an asciinema URL
#
# Or export to GIF:
#   agg docs/media/demo.cast docs/media/demo.gif   # needs asciinema/agg
#
# Do NOT run this script in your normal shell — it deliberately writes
# and deletes a demo memory entry.

set -euo pipefail

TYPEWRITER_DELAY="${TYPEWRITER_DELAY:-0.04}"
PAUSE_SHORT="${PAUSE_SHORT:-1.2}"
PAUSE_LONG="${PAUSE_LONG:-2.5}"

# Pretty-print a command as if the user is typing it, then execute.
type_and_run() {
	local cmd="$1"
	printf "\n\033[1;32m$ \033[0m"
	for ((i = 0; i < ${#cmd}; i++)); do
		printf "%s" "${cmd:i:1}"
		sleep "$TYPEWRITER_DELAY"
	done
	printf "\n"
	sleep "$PAUSE_SHORT"
	eval "$cmd"
	sleep "$PAUSE_SHORT"
}

clear
cat <<'EOF'
╔════════════════════════════════════════════════════════════╗
║  @event4u/agent-memory — 60-second setup                   ║
║                                                            ║
║  Persistent, trust-scored project memory for AI agents.    ║
║  MCP server + CLI, backed by Postgres + pgvector.          ║
╚════════════════════════════════════════════════════════════╝
EOF
sleep "$PAUSE_LONG"

# 1. Start the sidecar + Postgres.
type_and_run "docker compose up -d agent-memory"

# 2. Verify every prerequisite is in place.
type_and_run "docker compose exec -T agent-memory memory doctor 2>&1 | head -10"

# 3. A real query against the store.
type_and_run "docker compose exec -T agent-memory memory retrieve 'auth flow' --layer 1 | jq '.status'"

sleep "$PAUSE_LONG"
cat <<'EOF'

╔════════════════════════════════════════════════════════════╗
║  That's it. Point any MCP client at:                       ║
║                                                            ║
║    command: docker                                         ║
║    args: [compose, exec, -i, agent-memory, memory, mcp]    ║
║                                                            ║
║  Full guide → docs/consumer-setup-generic.md               ║
╚════════════════════════════════════════════════════════════╝

EOF
sleep "$PAUSE_LONG"
