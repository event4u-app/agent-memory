# syntax=docker/dockerfile:1.7
# @event4u/agent-memory — runtime image
#
# Multi-stage build:
#   1. builder: install all deps, compile TypeScript → dist/
#   2. runtime: copy dist/ + prod deps, drop builder toolchain
#
# Default ENTRYPOINT runs the MCP stdio server. Override with any
# `memory` subcommand (retrieve, ingest, health, …) for one-shot use.

ARG NODE_VERSION=20

# ---------- builder ----------
FROM node:${NODE_VERSION}-alpine AS builder

WORKDIR /app

# Install all deps (incl. dev) — needed for tsc.
# --ignore-scripts skips the postinstall agent-config sync; that sync is
# host-side tooling and has no business running inside the image.
# `npm install` (not `ci`) tolerates cross-platform lockfile diffs in
# optional platform-specific transitives (e.g. @emnapi/* inside biome's
# native addons) which npm 10 inside alpine rejects from a lockfile
# generated on macOS.
COPY package.json package-lock.json ./
RUN npm install --ignore-scripts --no-audit --no-fund

# Compile sources.
COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build

# Prune dev deps so the next stage can copy a lean node_modules/.
RUN npm prune --omit=dev --ignore-scripts

# ---------- runtime ----------
FROM node:${NODE_VERSION}-alpine AS runtime

# Tini gives clean SIGTERM/SIGINT propagation — important for the
# stdio MCP server where the agent client manages the lifecycle.
RUN apk add --no-cache tini

WORKDIR /app

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package.json ./package.json
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh

# Ensure the compiled CLI is executable and expose the `memory` binary
# via /usr/local/bin so `docker compose exec <svc> memory <cmd>` works
# without needing to remember the dist/ path. Matches what `npm link`
# would produce but without the extra install step.
RUN chmod +x dist/cli/index.js /usr/local/bin/docker-entrypoint.sh \
 && ln -s /app/dist/cli/index.js /usr/local/bin/memory \
 && chown -R node:node /app

# Non-root user; matches the pattern used by node:*-alpine which
# ships a `node` user (uid 1000) but starts as root.
USER node

# Documented runtime knobs — see README for the full list.
ENV NODE_ENV=production \
    LOG_LEVEL=info \
    DATABASE_URL=postgresql://memory:memory_dev@postgres:5432/agent_memory \
    MEMORY_AUTO_MIGRATE=true

# Entrypoint wraps the command in docker-entrypoint.sh which runs
# `memory migrate` on startup (idempotent) before exec'ing the CMD.
# Disable with MEMORY_AUTO_MIGRATE=false.
#
# Default CMD is `memory serve` — a supervisor loop (ADR-0002) that
# keeps the container alive with a real Node process. Consumers still
# spawn `memory mcp` and other CLI calls via `docker compose exec`.
ENTRYPOINT ["/sbin/tini", "--", "/usr/local/bin/docker-entrypoint.sh"]
CMD ["memory", "serve"]
