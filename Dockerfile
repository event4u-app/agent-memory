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

# Non-root user; matches the pattern used by node:*-alpine which
# ships a `node` user (uid 1000) but starts as root.
USER node

COPY --chown=node:node --from=builder /app/node_modules ./node_modules
COPY --chown=node:node --from=builder /app/dist ./dist
COPY --chown=node:node --from=builder /app/package.json ./package.json

# Documented runtime knobs — see README for the full list.
ENV NODE_ENV=production \
    LOG_LEVEL=info \
    DATABASE_URL=postgresql://memory:memory_dev@postgres:5432/agent_memory

ENTRYPOINT ["/sbin/tini", "--", "node", "dist/cli/index.js"]
CMD ["mcp"]
