#!/bin/sh
# agent-memory container entrypoint.
#
# Responsibilities:
#   1. Run pending database migrations on startup (idempotent).
#   2. Exec the user-supplied command (default: `memory mcp`).
#
# Opt out with MEMORY_AUTO_MIGRATE=false — useful for ephemeral CLI
# containers, read-only replicas, or CI jobs that run `memory migrate`
# as a separate step.
set -e

auto_migrate="${MEMORY_AUTO_MIGRATE:-true}"

# Never recurse: if the caller asked for `memory migrate` explicitly,
# don't run it again before they do.
case "$1 $2" in
	"memory migrate"*) auto_migrate="false" ;;
esac

if [ "$auto_migrate" = "true" ]; then
	echo "[agent-memory] auto-migrate: applying pending migrations…" >&2
	if ! memory migrate >&2; then
		echo "[agent-memory] auto-migrate failed — continuing startup." >&2
		echo "[agent-memory] run 'memory migrate' manually once the database is reachable." >&2
	fi
fi

exec "$@"
