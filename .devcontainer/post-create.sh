#!/usr/bin/env bash
# Devcontainer post-create: install deps, run migrations, smoke-test.
# Runs ONCE on container creation (not on every VS Code reconnect).
set -euo pipefail

cd /workspace

echo "▶ Installing npm dependencies…"
# --ignore-scripts avoids running the agent-config postinstall against
# a symlink target that may not yet exist in a fresh clone. The
# defensive postinstall (P1-4) already handles missing dependency.
npm ci

echo "▶ Building dist/ (prepare script is a no-op in CI installs)…"
npm run build

echo "▶ Running database migrations against postgres:5432 …"
npm run db:migrate

echo "▶ Smoke test: memory health"
# `memory health` exits 0 iff DB connection + pgvector extension are ok.
node dist/cli/index.js health || {
	echo "✖ memory health failed. Check Postgres health and DATABASE_URL."
	exit 1
}

echo ""
echo "✅ Devcontainer ready."
echo "   Try:  npm test"
echo "         npx tsx src/cli/index.ts retrieve 'how do invoices work?'"
echo ""
