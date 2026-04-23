<!--
  Thanks for the PR! Every section below is required — if a section
  does not apply, write "n/a" and keep moving. Read
  `CONTRIBUTING.md` first if you haven't.
-->

## What changed

<!-- One or two sentences. Link the roadmap task ID if applicable (e.g. Closes P3-8). -->

## Why

<!-- The motivation, not the diff. What problem does this solve? -->

## Scope / non-scope

- **In scope:**
- **Explicitly out of scope:**

## How to verify

<!-- Commands, URLs, MCP calls, or manual steps a reviewer can run. -->

```bash
# example
npm test
docker compose exec agent-memory memory health
```

## Verification pipeline — all six must be green locally

- [ ] `npm run lint`
- [ ] `npm run typecheck`
- [ ] `npm test` (current baseline: 251 tests)
- [ ] `npm run check:links`
- [ ] `npm run check:portability`
- [ ] `npm run docs:cli:check`

## Breaking changes / migration

<!-- Mark with `BREAKING CHANGE:` in commit footer if applicable. Otherwise n/a. -->

- [ ] No user-visible breaking changes.
- [ ] This PR breaks the retrieval contract (`contract_version`) — explain below and bump.
- [ ] This PR renames or removes a public path (doc, example, CLI flag) — mapping is in `CHANGELOG.md` under a "Renamed" subsection.

## Changelog

<!-- Paste the exact line you added to CHANGELOG.md under [Unreleased]. -->

```
- <type>(<scope>): <summary>
```

## Security considerations

<!-- Any credential handling, new ingestion paths, MCP tool surface,
     or external-service calls? If the change touches any of those,
     walk through what the threat model looks like. Otherwise n/a. -->

## Roadmap / related

- Closes: <!-- issue number or roadmap task ID -->
- Related:

## Checklist

- [ ] I opened this PR against `main` (or a labelled release branch).
- [ ] Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/).
- [ ] Diff is minimal and traceable to the stated task (no drive-by refactors).
- [ ] New code has tests where it makes sense; changed behaviour has regression coverage.
- [ ] Docs, `CHANGELOG.md`, and `docs/cli-reference.md` updated if the change is user-visible.
- [ ] I confirm this is **not** a security issue (security issues follow `SECURITY.md`).
