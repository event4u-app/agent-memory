#!/usr/bin/env bash
# Smoke test for the combined agent-config + agent-memory setup.
# Exit 0 = both pieces work together. Exit 1 = regression somewhere.

set -euo pipefail

cd "$(dirname "$0")"

# ── 1. agent-config: .augment/ hydration ─────────────────────────────────
#
# After `npm install`, .augment/skills/ should contain symlinks into
# node_modules/@event4u/agent-config/... If the directory is missing
# or empty, agent-config's postinstall didn't run or agent-memory's
# postinstall delegate broke.

if [ ! -d ".augment/skills" ]; then
  echo "❌  agent-config: .augment/skills/ missing — run 'npm install' first."
  exit 1
fi

skill_count="$(find .augment/skills -maxdepth 2 -name SKILL.md 2>/dev/null | wc -l | tr -d ' ')"

if [ "${skill_count}" -eq 0 ]; then
  echo "❌  agent-config: no SKILL.md files found under .augment/skills/."
  exit 1
fi

echo "✅  agent-config: .augment/skills/ hydrated (${skill_count} skills)"

# ── 2. agent-memory: container health ────────────────────────────────────

if ! docker compose ps --status running agent-memory >/dev/null 2>&1; then
  echo "❌  agent-memory: container not running — try 'docker compose up -d'."
  exit 1
fi

health_json="$(docker compose exec -T agent-memory memory health)"
status="$(printf '%s' "${health_json}" | tr -d '[:space:]' | sed -E 's/.*"status":"([^"]+)".*/\1/')"

if [ "${status}" != "ok" ] && [ "${status}" != "degraded" ]; then
  echo "❌  agent-memory: memory health returned status=${status}"
  echo "${health_json}"
  exit 1
fi

echo "✅  agent-memory: memory health returned status=${status}"

# ── 3. Combined: retrieval contract version ──────────────────────────────

contract="$(printf '%s' "${health_json}" | sed -E 's/.*"contract_version":([0-9]+).*/\1/')"

if [ "${contract}" != "1" ]; then
  echo "❌  combined: expected contract_version=1, got ${contract}"
  exit 1
fi

echo "✅  combined: retrieval contract version = ${contract}"
