# Copilot Repository Instructions

This repository is a **TypeScript / Node ≥ 20** library that implements a
trust-scored project memory for AI coding agents — an **MCP server** (stdio
transport) plus a **CLI** (`memory`), backed by **PostgreSQL + pgvector**.

> **For Copilot Chat users:** Deeper context lives in `.augment/` (skills,
> rules, guidelines) and `AGENTS.md`. The instructions below are
> self-contained for Copilot Code Review, which cannot follow links.

## ✅ Scope Control

- Do not introduce architectural changes unless explicitly requested.
- Do not replace existing patterns with alternatives.
- Do not suggest new libraries unless explicitly requested.
- Stay within the established module boundaries in `src/`.

## ✅ Architecture

- The package is a library + CLI + MCP server — **no web framework**.
- Module boundaries live under `src/` (`retrieval`, `trust`, `ingestion`,
  `consolidation`, `invalidation`, `quality`, `security`, `mcp`, `cli`,
  `db`). Keep concerns inside their module; cross-module calls go through
  the module's public entry file.
- The public package API is exported from `src/index.ts`. Anything not
  re-exported there is internal.
- MCP tools are registered in `src/mcp/tool-definitions.ts`. Never add a
  tool silently elsewhere — the catalog is the source of truth.
- The CLI (Commander) is the source of truth for command shapes; docs
  that describe CLI flags must match `src/cli/index.ts`.
- Database access goes through repositories in `src/db/`. Do not open raw
  `pg` clients from other modules.

## ✅ Coding Standards

- TypeScript **strict mode** — no `any`, no implicit `any`, no
  `ts-ignore` without a `// reason:` comment.
- Prefer `readonly` fields and `as const` for literal config.
- Use `import type { ... }` for type-only imports (ES modules, `.js`
  specifiers required in relative imports because of NodeNext).
- Explicit return types on exported functions and class methods.
- Prefer discriminated unions over string enums.
- Formatting and lint rules are enforced by **Biome** — do not nitpick
  style issues that `npm run lint:fix` auto-corrects.

## ✅ CLI Output Contract

- **`stdout`** is reserved for **machine-readable output** (pure JSON for
  scripted commands). Do not print logs, progress bars, or prompts there.
- **`stderr`** is for human-readable logs, warnings, and errors.
- Exit codes: `0` success, non-zero on failure. Commands that query memory
  must not return `0` when the retrieval fails — surface the error.

## ✅ Testing

- Test framework: **Vitest** (unit + integration, currently 240 tests).
- Run all tests: `npm test`
- Run a targeted test file: `npx vitest run path/to/file.test.ts`
- Run tests matching a name: `npx vitest run -t "partial test name"`
- Integration tests require Postgres: `docker compose up -d postgres-test`.
- New behavior MUST come with a Vitest test. Bug fixes MUST include a
  regression test that fails before the fix and passes after.

## ✅ Database & Migrations

- Migrations live in `src/db/migrations/` and run via `npm run db:migrate`.
- Never hand-edit applied migration files — add a new migration instead.
- Schema changes that affect retrieval must also update embedding
  dimensions / indexes consistently across `vector` columns.

## ✅ MCP & CLI Parity

- Every capability exposed via MCP tool should have a CLI equivalent (and
  vice versa) unless there's a documented reason. When adding one, check
  if the other already exists under a slightly different name.
- Public contracts (MCP tool schemas, CLI flags, exported API signatures)
  are versioned through `contract_version`. Breaking changes bump it.

## ✅ Legacy / Existing Code Handling

- Do NOT refactor existing code solely to comply with these rules.
- Only modify existing code if directly related to the current change,
  bug fix, security, or explicitly requested.
- New or newly modified code MUST follow all rules in this document.

## ✅ Code Review Scope

- Review **only the actually modified lines** and their direct dependencies.
- Do NOT review or suggest changes to unmodified code in the same file.
- Do NOT nitpick style issues that Biome auto-fixes.
- Direct dependencies include: functions called by the modified code,
  callers of the modified code, and types/interfaces it touches.

## ✅ Code Review Comment Behavior

- **Never create duplicate comments** — one comment per concern per location.
- Before posting, check if the same concern was already raised (by you or
  another reviewer) on the same line.
- **Never re-raise rejected suggestions** — if the developer said no,
  accept it. You may post **one** follow-up with additional analysis if
  you suspect a misunderstanding, then stop.
- Answer questions concisely; do not argue.
- Resolve conversations once the issue is addressed.

## ✅ Language Rules

- Code comments: **English**.
- Identifiers (variables, functions, types, files): **English**.
- Commit messages: **English**, Conventional Commits (`feat:`, `fix:`,
  `chore:`, `docs:`, `refactor:`, `test:`).
- User-facing strings: CLI is English-only (no i18n); JSON output on
  `stdout` per the CLI contract above.

## ✅ Package Management

- Always use `npm install <pkg>` / `npm uninstall <pkg>` — never
  hand-edit `package.json` or `package-lock.json`. npm resolves versions
  and keeps the lockfile consistent.
- This package uses **npm** (lockfile: `package-lock.json`). Do not
  introduce `yarn.lock` or `pnpm-lock.yaml`.

## ✅ Copilot Behavior

- Generate **TypeScript (strict) targeting Node ≥ 20** — avoid features
  from newer Node versions unless `engines.node` is bumped.
- Prioritize **readable, clean, maintainable** code over cleverness.
- Default to **immutability**, **narrow types**, and **explicit boundaries**.
- Be direct and concise — no "Sure!", "You're right!" or similar filler.
