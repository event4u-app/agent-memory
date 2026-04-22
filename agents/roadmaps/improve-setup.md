# Roadmap — improve-setup

**Branch:** `feat/improve-setup`
**Goal:** Lift `@event4u/agent-memory` from "works on the author's box" to a
wow-level install experience for external consumers — especially non-Node
projects (PHP / Laravel) using `@event4u/agent-config`.
**Status:** Planning. V1 shipped via PR #1 (merged main). 240 tests green.

## Guiding principles

1. **Docs must match the CLI.** `src/cli/index.ts` is the source of truth.
   Any documented flag that doesn't exist in Commander is a bug.
2. **Consumers run `agent-memory` as a sidecar**, not as a local Node app.
   Docker Compose is the first-class install surface; `npm install` is
   the second for Node consumers.
3. **Ship hygiene is non-negotiable.** LICENSE, `files`, `prepare`,
   defensive `postinstall`, usable from a fresh `git clone`.
4. **Drift prevention over drift correction.** Generate what we can
   (CLI reference, tool catalog), enforce the rest in CI.

## Phase overview

| Phase | Theme | Tasks | Blocks downstream? |
|---|---|---|---|
| P0 | Documentation drift reconciliation | 6 | Yes — PHP consumer guide depends on correct CLI |
| P1 | Ship-hygiene (publishability) | 7 | Yes — image build and npm publish need this |
| P2 | Docker-first sidecar | 6 | Yes — consumer guide and examples depend on image |
| P3 | Consumer integration guides | 5 | — |
| P4 | Maintainability / drift-prevention | 4 | — |
| P5 | Wow polish (stretch) | 4 | — |

Execute strictly in order P0 → P4. P5 is optional and can be picked up
any time after P3.

---

## Phase 0 — Documentation Drift Reconciliation

Cheapest, highest immediate value: consumers can actually follow the docs.

### P0-1 · CLI audit — docs vs commander
- **Why:** Three confirmed drift points already; full audit needed to
  catch the rest before guides reference them.
- **Scope:** Produce a side-by-side table of every command in
  `docs/cli-reference.md` and `README.md` vs `src/cli/index.ts` (flags,
  arguments, defaults). Attach as PR description.
- **Done:** Audit table committed or pasted in PR; every row marked
  ✅ match / 🔴 drift with target fix.

### P0-2 · Fix `propose` scenario flag
- **Why:** Docs say `--future-scenario`, CLI uses `--scenario` (see
  `src/cli/index.ts` L427).
- **Scope:** `docs/cli-reference.md` L59, L62, any README mention.
- **Done:** `grep -n "future-scenario" docs README.md` returns nothing.

### P0-3 · Fix `promote` signature
- **Why:** Docs show `memory promote --entry <uuid> --evidence-ref adr-017.md`.
  CLI uses **positional** `<proposal-id>`, has **no** `--entry`, has **no**
  `--evidence-ref` (only `--allowed-type` repeatable and
  `--skip-duplicate-check`).
- **Scope:** `docs/cli-reference.md` L64–74, README equivalent.
- **Done:** Example reads `memory promote <proposal-id> [--allowed-type …]`;
  `--entry` and `--evidence-ref` removed.

### P0-4 · Fix `invalidate --to-ref`
- **Why:** Docs L94 show `--to-ref HEAD`, which doesn't exist. CLI has
  `--from-ref` and `--since` as alternatives; `to` is implicit HEAD.
- **Scope:** Remove `--to-ref` from example; add a note that
  comparison target is always HEAD; document `--since <date>` as
  alternative to `--from-ref`.
- **Done:** `grep -n "to-ref" docs/` returns nothing.

### P0-5 · Audit README for the same drift
- **Why:** README has its own copy of CLI examples (different wording,
  same risk). Confirmed drift propagates unless audited.
- **Scope:** Apply P0-2 / P0-3 / P0-4 fixes to README; harmonize
  examples so README and `docs/cli-reference.md` don't contradict.
- **Done:** Cross-grep passes; README points at cli-reference.md for
  the exhaustive list.

### P0-6 · Mark source of truth
- **Why:** Prevent future drift from well-meaning contributors.
- **Scope:** Add a banner at the top of `docs/cli-reference.md`:
  *"Source of truth: `src/cli/index.ts`. Regenerate with
  `npm run docs:cli` (see P4-1)."*
- **Done:** Banner present; README links to it.

---

## Phase 1 — Ship-Hygiene

Make the package installable from npm, from Git, and from a fresh clone
without hand-holding.

### P1-1 · Add LICENSE file
- **Why:** `package.json` declares `"license": "MIT"` but no LICENSE
  file exists. npm and GitHub flag this; some consumers refuse to
  depend on packages without a LICENSE file.
- **Scope:** Create `LICENSE` with standard MIT text, year 2026,
  copyright holder "event4u".
- **Done:** `ls LICENSE` succeeds; npm pack includes it.

### P1-2 · Add `files` whitelist
- **Why:** Currently unset → npm includes everything. Ships unnecessary
  bulk (tests, `.augment/`, `agents/`), and fails for git-installs
  because `dist/` isn't built.
- **Scope:** `package.json.files = ["dist", "README.md", "LICENSE"]`.
- **Done:** `npm pack --dry-run` lists only those entries.

### P1-3 · Add `prepare` script
- **Why:** Git installs (`npm install github:event4u-app/agent-memory`)
  don't have `dist/`. `prepare` runs on install-from-git.
- **Scope:** `package.json.scripts.prepare = "npm run build"`.
- **Done:** Git install into a throwaway project yields a working
  `node_modules/@event4u/agent-memory/dist/cli/index.js`.

### P1-4 · Defensive `postinstall`
- **Why:** Current script hard-references
  `node_modules/@event4u/agent-config/scripts/install.sh`. Fails hard
  when consumer hasn't installed agent-config, or in non-Node Docker
  layers where `node_modules` is absent (e.g. PHP consumer pulling the
  published image).
- **Scope:** Wrap in `[ -f path ] && bash path --quiet || true`;
  emit a one-line notice when skipped; never fail the install.
- **Done:** `npm install @event4u/agent-memory` without agent-config
  present exits 0 with an informational log.

### P1-5 · Add `repository`, `homepage`, `bugs`
- **Why:** Missing fields hurt npm page, GitHub integration, and Dependabot.
- **Scope:** Add all three pointing at
  `https://github.com/event4u-app/agent-memory`.
- **Done:** `npm view` (after publish) shows the metadata.

### P1-6 · Add `exports` map
- **Why:** Consumers importing submodules (e.g. `@event4u/agent-memory/cli`)
  hit no-entry errors. Explicit `exports` also prevents accidental
  imports of internals.
- **Scope:** `exports = { ".": "./dist/index.js", "./cli": "./dist/cli/index.js" }`
  with matching `types` conditions.
- **Done:** `import { retrieve } from "@event4u/agent-memory"` resolves;
  internal imports like `@event4u/agent-memory/src/trust` don't.

### P1-7 · `publishConfig.access = public`
- **Why:** `@event4u/` is a scoped package; npm defaults scoped packages
  to private. First `npm publish` will fail without this.
- **Scope:** `package.json.publishConfig = { "access": "public" }`.
- **Done:** `npm publish --dry-run` reports public access.

---

## Phase 2 — Docker-First Sidecar

Goal: consumer runs **one command** and gets a working MCP endpoint.

### P2-1 · Write `Dockerfile`
- **Why:** No Dockerfile today; image can't be published.
- **Scope:** Multi-stage: `node:20-alpine` builder (npm ci + build) →
  runtime image (only `dist/`, `package.json`, prod deps). Expose nothing
  (stdio MCP) but set `ENTRYPOINT ["node", "dist/cli/index.js"]`.
- **Done:** `docker build .` succeeds; image under 200 MB.

### P2-2 · Add `.dockerignore`
- **Why:** Avoid shipping `node_modules/`, `tests/`, `agents/`,
  `.augment/`, `.git/`, etc. into the build context.
- **Scope:** Standard Node `.dockerignore`.
- **Done:** `docker build` context reported < 5 MB.

### P2-3 · Extend `docker-compose.yml` with `agent-memory` service
- **Why:** Today compose only runs Postgres. Consumers still need a
  local Node setup to boot the MCP server.
- **Scope:** Add `agent-memory` service pulling the published image
  (fallback to local build), `depends_on: postgres (service_healthy)`,
  env passthrough for `DATABASE_URL`, health check via `memory health`.
  Add a named network so a consumer compose file can `external: true`
  into it.
- **Done:** `docker compose up` yields a healthy agent-memory service;
  `docker compose exec agent-memory memory health` returns OK.

### P2-4 · Implement `memory mcp` CLI subcommand
- **Why:** `npm run mcp:start` is a script, not a first-class command.
  Consumer MCP clients (e.g. Augment in an external project) need a
  stable binary invocation like `memory mcp`.
- **Scope:** Add a `mcp` subcommand to Commander that does what
  `src/mcp/server.ts` does today. Keep `mcp:start` script as alias for
  backward compatibility.
- **Done:** `memory mcp` starts the stdio MCP server; docs and MCP
  client-config examples use it.

### P2-5 · GH Actions — build & push image
- **Why:** Consumers need `ghcr.io/event4u-app/agent-memory:latest`.
- **Scope:** Workflow on push to main + tags: build image, push to
  `ghcr.io/event4u-app/agent-memory` with `latest` + `vX.Y.Z` + sha tags.
  Reuse existing repo secrets.
- **Done:** A tag push produces a public pullable image.

### P2-6 · Document the one-command start
- **Why:** The whole point of this phase.
- **Scope:** Top of README: a 5-line "Run it" section —
  `curl -O docker-compose.yml && docker compose up`. Link to full
  configuration for customization.
- **Done:** A fresh machine with only Docker can follow README top
  section and reach `memory health → ok` in < 2 minutes.

---

## Phase 3 — Consumer Integration Guides

### P3-1 · `docs/consumer-setup-php.md`
- **Why:** The primary external consumer is a PHP/Laravel app using
  `@event4u/agent-config`. They need an end-to-end guide that does NOT
  assume Node knowledge.
- **Scope:** docker-compose sidecar pattern, env wiring, how to invoke
  the CLI via `docker compose exec`, MCP client config for
  Augment/Claude/Cursor inside a PHP repo, troubleshooting checklist.
- **Done:** A PHP developer who has never touched Node can reproduce
  the setup from scratch.

### P3-2 · `docs/consumer-setup-node.md`
- **Why:** Node consumers want programmatic use (import) AND CLI.
- **Scope:** Install, import signature examples for `retrieve`,
  `propose`, `promote`, `health`; CLI fallback; migration management.
- **Done:** Sample code compiles with `tsc --strict`.

### P3-3 · `examples/php-laravel-sidecar/`
- **Why:** Copy-pasteable beats prose.
- **Scope:** Minimal runnable folder — `docker-compose.yml` that
  includes the agent-memory service, a Laravel-style `.env.example`,
  a `README.md` explaining the 3-step setup.
- **Done:** From `cd examples/php-laravel-sidecar && docker compose up`
  the stack comes up healthy.

### P3-4 · `examples/node-programmatic/`
- **Why:** Same reason, Node side.
- **Scope:** Minimal Node project with `package.json`, `index.ts`,
  `.env.example`. One retrieve call, one propose call.
- **Done:** `npm install && npm start` produces JSON output.

### P3-5 · Cross-link from README
- **Why:** Guides are useless if invisible.
- **Scope:** "Integrate with your project" section linking P3-1/P3-2/
  examples.
- **Done:** README Table of Contents reaches both guides in one click.

---

## Phase 4 — Maintainability / Drift-Prevention

### P4-1 · CLI doc generator
- **Why:** P0 fixes existing drift; this prevents the next round.
- **Scope:** `scripts/generate-cli-docs.ts` — walks the Commander
  `program.commands`, emits `docs/cli-reference.md` with a hand-written
  preamble and autogenerated command sections. `npm run docs:cli`.
- **Done:** `npm run docs:cli && git diff --exit-code docs/cli-reference.md`
  is clean on main.

### P4-2 · CI drift guard
- **Why:** P4-1 only helps if it runs.
- **Scope:** GH Action step in the existing CI: run `npm run docs:cli`,
  fail if the diff is non-empty. Message points reviewers at P4-1.
- **Done:** A deliberate drift in a sandbox PR fails CI with a clear
  pointer.

### P4-3 · Portability-guard CI
- **Why:** Prevent re-leakage of foreign-project identifiers (like the
  Laravel leak just removed from `.github/copilot-instructions.md`).
- **Scope:** CI step running
  `node_modules/@event4u/agent-config/scripts/check_portability.py`
  over `README.md`, `AGENTS.md`, `.github/copilot-instructions.md`,
  `docs/`, `examples/`. Fail on blocklist hits.
- **Done:** Intentionally adding `laravel` to README fails CI.

### P4-4 · Link-checker in CI
- **Why:** The docs link to files and anchors; broken links erode trust.
- **Scope:** Run `lychee` (or equivalent) against all `*.md`. Allow-list
  external URLs that 403 on bots.
- **Done:** A broken relative link fails CI.

---

## Phase 5 — Wow Polish (stretch, optional)

### P5-1 · `.devcontainer/`
- **Why:** Contributors get zero-setup Node 20 + Postgres + pgvector.
- **Scope:** `devcontainer.json` pulling `node:20`, feature
  `pgvector`, post-create `npm install && npm run db:migrate`.
- **Done:** "Open in Codespaces" button works end-to-end; tests green
  on first run.

### P5-2 · `memory doctor`
- **Why:** Self-diagnosing beats reading error messages.
- **Scope:** New CLI command verifying: `DATABASE_URL` reachable,
  `pgvector` extension present, latest migration applied, optional
  `agent-config` symlinks intact. Single JSON output plus human
  summary on stderr.
- **Done:** `memory doctor` prints a green report on a healthy setup,
  a machine-readable failure on any broken component.

### P5-3 · 60-second quick-start in README
- **Why:** Marketing value; first-30-second impression decides
  adoption.
- **Scope:** Top-of-README block: what it is (1 sentence), run it
  (one command), query it (one command), integrate it (one link).
- **Done:** A cold reader understands the value prop in < 1 minute.

### P5-4 · Asciinema / GIF of the one-command setup
- **Why:** Same reason as P5-3, visual channel.
- **Scope:** Record a ~40s asciinema (or mp4/gif) of
  `docker compose up` → `memory health` → `memory retrieve "…"`.
  Host under `docs/media/`.
- **Done:** Embedded at top of README.

---

## Completion checklist

Per phase, a PR is considered done when:

- All phase tasks' Done-criteria are satisfied with fresh evidence
  (command output, failing-then-passing test, CI green).
- `npm test` and `npm run typecheck` green.
- `npm run lint` clean (no new warnings).
- New consumer-facing surface documented in README **and**
  `docs/cli-reference.md` regenerated (once P4-1 exists).
- No drive-by edits outside the phase scope (per `minimal-safe-diff`).

## Deferred / out of scope

- Public npm publishing. P1 makes it possible; the actual `npm publish`
  decision and the first released version are governance, not setup.
- Helm chart / k8s manifests. Docker Compose is the primary sidecar
  surface for now.
- MCP-over-SSE transport. Stdio is the only supported transport per
  the contract.

## Follow-ups outside this roadmap

- `agent-config` integration contract updates triggered by any CLI
  signature change in P0 — coordinate via
  `agents/roadmaps/archive/from-agent-config/road-to-retrieval-contract.md`.
