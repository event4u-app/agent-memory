#!/usr/bin/env bash
# Smoke test for the claude-desktop MCP integration snippet.
#
# Exit 0 = the copy-paste path is valid: config parses, config has the
# shape Claude Desktop requires, and the `memory` binary referenced in
# Option B actually responds.
#
# Does NOT spawn Claude Desktop itself and does NOT run an MCP protocol
# round-trip (that needs Postgres). Those live elsewhere — see
# README.md § "What the smoke does NOT test".

set -euo pipefail

cd "$(dirname "$0")"

config="claude_desktop_config.example.json"

# ── 1. Config JSON is syntactically valid ────────────────────────────────

if [ ! -f "${config}" ]; then
  echo "❌  ${config} is missing"
  exit 1
fi

if ! jq -e . "${config}" > /dev/null 2>&1; then
  echo "❌  ${config} is not valid JSON"
  jq . "${config}" || true
  exit 1
fi

echo "✅  ${config} parses as JSON"

# ── 2. Config has the mcpServers shape Claude Desktop expects ────────────
#
# Minimum Claude Desktop will accept: mcpServers["agent-memory"] with a
# non-empty string command and an array args. No env is required for
# the sidecar variant — the compose file carries DATABASE_URL etc.

if ! jq -e '
  .mcpServers["agent-memory"]
  | (.command | type == "string" and length > 0)
    and (.args | type == "array")
' "${config}" > /dev/null; then
  echo "❌  ${config}: .mcpServers[\"agent-memory\"] missing or malformed"
  echo "    required: .command (non-empty string), .args (array)"
  exit 1
fi

echo "✅  ${config} has .mcpServers[\"agent-memory\"] with command + args"

# ── 3. memory binary (Option B) is runnable ──────────────────────────────
#
# Resolution order:
#   1. $MEMORY_BIN — CI sets this to the absolute dist path after build
#   2. `memory` on PATH — developer ran `npm install -g` or `npm link`
#   3. <repo>/dist/cli/index.js — developer ran `npm run build` locally
#
# This mirrors how an end-user would arrive at the binary: either a
# global install (Option B in README) or a local build during iteration.

repo_root="$(cd ../../.. && pwd)"
dist_entry="${repo_root}/dist/cli/index.js"

resolved=""
if [ -n "${MEMORY_BIN:-}" ]; then
  # shellcheck disable=SC2086   — intentional word-splitting for "node path"
  if ${MEMORY_BIN} --version > /dev/null 2>&1; then
    resolved="\$MEMORY_BIN"
  fi
elif command -v memory > /dev/null 2>&1; then
  if memory --version > /dev/null 2>&1; then
    resolved="memory (PATH)"
  fi
elif [ -f "${dist_entry}" ]; then
  if node "${dist_entry}" --version > /dev/null 2>&1; then
    resolved="node dist/cli/index.js"
  fi
fi

if [ -z "${resolved}" ]; then
  echo "❌  memory binary not runnable."
  echo "    Tried: \$MEMORY_BIN, 'memory' on PATH, ${dist_entry}"
  echo "    Fix: 'npm run build' in the repo root, or 'npm install -g @event4u/agent-memory'."
  exit 1
fi

echo "✅  memory binary responds to --version (via ${resolved})"

echo ""
echo "✨  claude-desktop integration smoke passed"
