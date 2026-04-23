# Contributing to `@event4u/agent-memory`

Thanks for taking an interest in the project. This file documents what
we expect from contributions and how to validate them locally before
opening a pull request.

> **Before you start:** browse the existing [roadmap](agents/roadmaps/improve-system.md)
> and the [open issues](https://github.com/event4u-app/agent-memory/issues)
> so we don't duplicate work. For architectural changes, please open a
> discussion first — small fixes and documentation improvements can go
> straight to a PR.

## Dev setup

See [`README.md`](README.md#installation) and
[`AGENTS.md`](AGENTS.md#development-setup) for the authoritative setup.
The short version:

```bash
docker compose up -d postgres      # Postgres 15+ with pgvector
npm install                        # Node 20+, npm lockfile is committed
npm run db:migrate                 # applies bundled migrations
npm test                           # 251 tests, vitest
```

The DevContainer in `.devcontainer/` gives you Node 20, Postgres, and
pgvector pre-wired if you prefer a one-command start.

## Scope of contribution

- **Bug fix** — include a regression test that fails before the fix
  and passes after. Target the specific failure, not an unrelated
  refactor in the same diff (see the scope-control rule).
- **Feature** — open an issue describing the use case first. Features
  that touch the retrieval contract must land with fixture updates in
  `tests/contract/` and a CHANGELOG entry.
- **Documentation** — free-form, but run `npm run check:links` and
  `npm run check:portability` so the docs pipeline stays green.
- **Roadmap item** — reference the task ID (`P0-1`, `P3-4b`, …) in
  the commit message so the roadmap can be updated.

## Coding conventions

- **TypeScript strict mode**, ES modules, Node ≥ 20.
- **Biome** handles linting and formatting
  ([`biome.json`](biome.json)). Run `npm run lint` before committing;
  `npm run lint:fix` auto-applies safe fixes.
- **Prefer editing an existing file over creating a new one** — match
  the commenting style and density of surrounding code rather than
  introducing your own.
- **No unrelated reformatting.** Keep the diff minimal and traceable
  to the stated task.
- **Privacy filter is non-negotiable.** Any new ingestion path must
  pass user-provided text through `applyPrivacyFilter()` before
  embedding or storage.

## Commit messages

We follow [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/).
Format:

```
<type>(<scope>): <summary>

<body>
```

Common types: `feat`, `fix`, `docs`, `chore`, `refactor`, `test`, `ci`,
`perf`, `build`. Use scopes that reference the touched subsystem
(`cli`, `db`, `mcp`, `retrieval`, `trust`, `ingestion`, `docs`,
`deps`). If the commit resolves a roadmap task, cite the task ID in
the body (`Closes P3-8.`).

Breaking changes: prefix with `!` (`feat(cli)!: …`) **and** add a
`BREAKING CHANGE:` footer describing the migration path. Breaking
changes land in a minor or major release, never in a patch.

## Verification pipeline — run everything before opening a PR

```bash
npm run lint          # biome
npm run typecheck     # tsc --noEmit
npm test              # vitest, 251 tests at time of writing
npm run check:links   # lychee (requires Docker)
npm run check:portability   # blocks Laravel/Eloquent/Blade leaks
npm run docs:cli:check      # regenerates and diffs docs/cli-reference.md
```

All six must exit 0. CI runs the same commands via
`.github/workflows/code-checks.yml` and
`.github/workflows/docs-checks.yml`; opening a PR before the local
checks pass wastes CI minutes and triage cycles.

## PR workflow

1. **Branch from `main`** with a descriptive name
   (`feat/my-change`, `fix/mcp-timeout`, `docs/glossary-update`).
2. **Commit in logical units** — a fix, a test, a doc update should
   each be their own commit where practical. Squash-merge on the
   GitHub UI is the default, but a clean history helps review.
3. **Update `CHANGELOG.md`** under `[Unreleased]` for any user-visible
   change. Link the PR number; group entries under
   `Added / Changed / Fixed / Renamed / Removed / Security`.
4. **Fill in the PR template** (`.github/PULL_REQUEST_TEMPLATE.md`)
   in full. Empty sections get the PR bounced — if a section does not
   apply, write "n/a" and keep moving.
5. **Address review comments in-place** rather than force-pushing the
   branch. Maintainers will squash at merge time.
6. **Keep CI green.** Flaky retries are fine, but a PR that can only
   merge with a red check needs a linked issue explaining why.

## Reporting bugs and security issues

- Functional bugs → `.github/ISSUE_TEMPLATE/bug_report.yml`. Include
  the `memory doctor` JSON output and the package version.
- Security issues → [`SECURITY.md`](SECURITY.md). Do not open public
  issues for vulnerabilities.

## Release process

Releases are maintainer-driven:

1. `[Unreleased]` section in `CHANGELOG.md` is renamed to the new
   version with a date.
2. `package.json` version is bumped; tag `vX.Y.Z` pushed.
3. GHCR workflow publishes the image on tag.
4. npm publish is triggered from the tag.

Contributors do **not** bump versions or create tags.

## Questions

Open a discussion on the repository or ask on the PR. Thanks for
contributing.
