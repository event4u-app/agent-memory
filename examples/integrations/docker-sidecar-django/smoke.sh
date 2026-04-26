#!/usr/bin/env bash
# Smoke test for the docker-sidecar-django integration template.
#
# Static-only: validates the copy-paste template without booting the
# stack. See README.md § "What the smoke does NOT test" for boundaries.
#
# Four checks, all of which fail loud:
#   1. docker-compose.example.yml parses (`docker compose config`).
#   2. postgres + agent-memory services both exist.
#   3. agent-memory has a healthcheck (required for service_healthy gating).
#   4. Every `memory <subcommand>` in memory_service.example.py is a
#      real CLI command (scraped from `memory --help`).

set -euo pipefail

cd "$(dirname "$0")"

compose="docker-compose.example.yml"
host_code="memory_service.example.py"

# ── 0. Prerequisites ─────────────────────────────────────────────────────

if ! command -v docker > /dev/null 2>&1; then
  echo "❌  docker not found on PATH."
  echo "    This is a sidecar integration — docker compose v2 is required."
  exit 1
fi

if ! docker compose version > /dev/null 2>&1; then
  echo "❌  'docker compose' (v2) not available."
  echo "    Install Docker Desktop or a matching compose plugin."
  exit 1
fi

# ── 1. Compose parses via `docker compose config` ────────────────────────

if ! parsed=$(docker compose -f "${compose}" config --format json 2> /tmp/compose-err.$$); then
  echo "❌  ${compose} did not validate:"
  cat /tmp/compose-err.$$
  rm -f /tmp/compose-err.$$
  exit 1
fi
rm -f /tmp/compose-err.$$

echo "✅  ${compose} validates with 'docker compose config'"

# ── 2. Required services present ─────────────────────────────────────────

for svc in postgres agent-memory; do
  if ! echo "${parsed}" | jq -e --arg s "${svc}" '.services[$s]' > /dev/null; then
    echo "❌  ${compose}: service '${svc}' missing"
    exit 1
  fi
done

echo "✅  ${compose} declares postgres + agent-memory"

# ── 3. agent-memory has a healthcheck ────────────────────────────────────

if ! echo "${parsed}" | jq -e '.services["agent-memory"].healthcheck.test' > /dev/null; then
  echo "❌  ${compose}: agent-memory has no healthcheck"
  echo "    service_healthy depends_on won't work without one."
  exit 1
fi

echo "✅  ${compose}: agent-memory has a healthcheck"

# ── 4. Referenced memory subcommands are real ────────────────────────────
#
# MemoryService uses `self._run(["<subcommand>", ...])` — the subcommand
# is always the FIRST string literal inside the list passed to _run().
# Collapse newlines with tr so multi-line _run([\n    "ingest", ...])
# invocations become searchable on one logical line, then anchor on
# `_run([<optional-ws>"cmd"`. This avoids false positives from prose
# in doc comments (e.g. "agent-memory as a sidecar" → fake 'as' cmd).
#
# `|| true` swallows grep's exit-1-on-no-match so pipefail doesn't kill
# the script before we emit the clear error below.

cmds=$(tr '\n' ' ' < "${host_code}" \
  | grep -oE '_run\([[:space:]]*\[[[:space:]]*"[a-z][a-z_-]+"' \
  | sed -E 's|.*"([^"]+)"$|\1|' \
  | sort -u \
  || true)

if [ -z "${cmds}" ]; then
  echo "❌  ${host_code}: no _run([\"<cmd>\"]) invocations found"
  echo "    Expected pattern: self._run([\"health\"]) or self._run([\"ingest\", ...])"
  exit 1
fi

# shellcheck disable=SC2086
echo "✅  ${host_code} invokes memory:" $(echo "${cmds}" | tr '\n' ' ')

# ── 5. Resolve memory binary for subcommand validation ───────────────────

repo_root="$(cd ../../.. && pwd)"
dist_entry="${repo_root}/dist/cli/index.js"

MEMORY_BIN="${MEMORY_BIN:-}"
resolved=""
if [ -n "${MEMORY_BIN}" ]; then
  # shellcheck disable=SC2086
  if ${MEMORY_BIN} --version > /dev/null 2>&1; then
    resolved="\$MEMORY_BIN"
  fi
elif command -v memory > /dev/null 2>&1; then
  if memory --version > /dev/null 2>&1; then
    MEMORY_BIN="memory"
    resolved="memory (PATH)"
  fi
elif [ -f "${dist_entry}" ]; then
  if node "${dist_entry}" --version > /dev/null 2>&1; then
    MEMORY_BIN="node ${dist_entry}"
    resolved="node dist/cli/index.js"
  fi
fi

if [ -z "${resolved}" ]; then
  echo "❌  memory binary not runnable (tried \$MEMORY_BIN, PATH, ${dist_entry})"
  echo "    Fix: 'npm run build' in the repo root."
  exit 1
fi

echo "✅  resolved memory binary via ${resolved}"

# ── 6. Membership-check each referenced subcommand ───────────────────────

# shellcheck disable=SC2086
known=$(${MEMORY_BIN} --help 2>/dev/null \
  | awk '/^Commands:/{in_block=1; next} in_block && /^  [a-z]/{print $1}' \
  | sort -u)

if [ -z "${known}" ]; then
  echo "❌  could not parse subcommand list from 'memory --help'"
  exit 1
fi

for cmd in ${cmds}; do
  if ! printf '%s\n' "${known}" | grep -qx "${cmd}"; then
    echo "❌  ${host_code} references 'memory ${cmd}' but the CLI has no such subcommand"
    echo "    Known: $(echo ${known} | tr '\n' ' ')"
    exit 1
  fi
  echo "✅  memory ${cmd} is a real subcommand"
done

echo ""
echo "✨  docker-sidecar-django integration smoke passed"
