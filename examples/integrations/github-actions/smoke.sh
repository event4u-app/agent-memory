#!/usr/bin/env bash
# Smoke test for the github-actions CLI integration snippet.
#
# Static-only: this smoke NEVER runs the workflow end-to-end (that
# would need a hosted Postgres). It validates the copy-paste template
# still references real CLI commands and has the minimum shape a
# GitHub Actions workflow needs.
#
# The meat of this check is step 5: every `memory <subcommand>` in
# the snippet is verified against the live CLI. If a subcommand gets
# renamed or deleted upstream, this smoke goes red before the stale
# snippet reaches a user.

set -euo pipefail

cd "$(dirname "$0")"

snippet="ci-agent.example.yml"

# ── 1. File present and non-empty ────────────────────────────────────────

if [ ! -s "${snippet}" ]; then
  echo "❌  ${snippet} missing or empty"
  exit 1
fi

echo "✅  ${snippet} present"

# ── 2. Has jobs: block ───────────────────────────────────────────────────

if ! grep -qE '^jobs:' "${snippet}"; then
  echo "❌  ${snippet}: no top-level jobs: block"
  exit 1
fi

echo "✅  ${snippet} declares jobs:"

# ── 3. Uses actions/checkout ─────────────────────────────────────────────

if ! grep -qE 'uses:[[:space:]]+actions/checkout' "${snippet}"; then
  echo "❌  ${snippet}: no actions/checkout step (hard requirement for REPO_ROOT)"
  exit 1
fi

echo "✅  ${snippet} uses actions/checkout"

# ── 4. Collect every memory subcommand referenced ───────────────────────
#
# Match `memory <subcommand>` only when "memory" is NOT preceded by
# an alphanumeric char or hyphen — that excludes the prose form
# "agent-memory as a CLI tool" (which would otherwise produce the
# false positive subcommand "as"). Commander replies with the root
# help text and exit 0 on unknown subcommands, so false positives
# pass the --help probe silently if we don't filter them here.

cmds=$(grep -oE '(^|[^A-Za-z0-9-])memory[[:space:]]+[a-z][a-z_-]+' "${snippet}" \
  | sed -E 's/^[^m]*memory[[:space:]]+//' \
  | sort -u)

if [ -z "${cmds}" ]; then
  echo "❌  ${snippet}: no memory CLI invocations found"
  exit 1
fi

# shellcheck disable=SC2086
echo "✅  ${snippet} invokes memory:" $(echo "${cmds}" | tr '\n' ' ')

# ── 5. Resolve memory binary ─────────────────────────────────────────────

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
  echo "❌  memory binary not runnable."
  echo "    Tried: \$MEMORY_BIN, 'memory' on PATH, ${dist_entry}"
  echo "    Fix: 'npm run build' in the repo root."
  exit 1
fi

echo "✅  resolved memory binary via ${resolved}"

# ── 6. Each referenced subcommand is a real CLI command ─────────────────
#
# NOTE on Commander behavior: running `memory <unknown> --help` exits 0
# and prints the root help text (Commander treats the unknown token as
# "no subcommand given"). We therefore can't rely on exit code from
# --help to tell real from fake. Instead, extract the known-command
# list from the root help once and membership-check against it.

# shellcheck disable=SC2086
# Commander's help output starts each command with exactly two leading
# spaces before the name. Wrapped description continuations are indented
# much further (~33 cols). Anchor on the exact 2-space prefix so words
# from a wrapped description ("as JSON", "or pending") aren't mistaken
# for subcommand names.
known=$(${MEMORY_BIN} --help 2>/dev/null \
  | awk '/^Commands:/{in_block=1; next} in_block && /^  [a-z]/{print $1}' \
  | sort -u)

if [ -z "${known}" ]; then
  echo "❌  could not parse subcommand list from 'memory --help'"
  exit 1
fi

for cmd in ${cmds}; do
  if ! printf '%s\n' "${known}" | grep -qx "${cmd}"; then
    echo "❌  snippet references 'memory ${cmd}' but the CLI has no such subcommand"
    echo "    Known subcommands: $(echo ${known} | tr '\n' ' ')"
    exit 1
  fi
  echo "✅  memory ${cmd} is a real subcommand"
done

echo ""
echo "✨  github-actions integration smoke passed"
