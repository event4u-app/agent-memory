#!/usr/bin/env bash
# Defensive postinstall for @event4u/agent-memory.
#
# Tries to delegate to @event4u/agent-config's install.sh when that package
# is resolvable, but never fails the install if it is absent (e.g. consumers
# who don't use agent-config, or container layers without node_modules).
#
# Exit status: always 0.

set -u

INSTALLER="node_modules/@event4u/agent-config/scripts/install.sh"

if [ ! -f "$INSTALLER" ]; then
  printf '[agent-memory] agent-config not present, skipping optional sync\n' >&2
  exit 0
fi

if ! bash "$INSTALLER" --quiet; then
  printf '[agent-memory] agent-config install.sh failed, continuing anyway\n' >&2
fi

exit 0
