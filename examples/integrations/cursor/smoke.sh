#!/usr/bin/env bash
# Smoke test for the cursor MCP integration snippet.
#
# Exit 0 = the copy-paste path is valid: config parses as JSON, has
# the shape Cursor requires, and the `memory` binary referenced in
# Option B actually responds.
#
# Does NOT spawn Cursor and does NOT run an MCP protocol round-trip
# (needs Postgres). See README.md § "What the smoke does NOT test".
#
# Cursor uses the exact same mcpServers shape as Claude Desktop, so
# this smoke mirrors claude-desktop's structure. The one thing we do
# NOT validate is ${workspaceFolder} expansion — Cursor does that at
# runtime. The template deliberately uses only variables documented
# in Cursor's MCP docs.

set -euo pipefail

cd "$(dirname "$0")"

config="mcp.example.json"

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

# ── 2. Config has the mcpServers shape Cursor expects ────────────────────
#
# Minimum Cursor will accept: mcpServers["agent-memory"] with a
# non-empty string command and an array args. `type: "stdio"` is
# recommended but optional — Cursor infers stdio from the presence of
# command+args.

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
# Resolution order mirrors claude-desktop/smoke.sh:
#   1. $MEMORY_BIN — CI sets this after `npm run build`
#   2. `memory` on PATH — developer ran `npm install -g` or `npm link`
#   3. <repo>/dist/cli/index.js — developer ran `npm run build` locally

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
echo "✨  cursor integration smoke passed"
