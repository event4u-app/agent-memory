# Deprecation policy

> **Status:** Accepted · ships with the Phase D release wave.
> **Roadmap:** [`agents/roadmaps/runtime-trust.md` · D5](../agents/roadmaps/runtime-trust.md).
> **Parent:** [ADR-0003 · Contract version bumps](../agents/adrs/0003-contract-version-bumps.md).

ADR-0003 defines *when* a schema change is additive vs. breaking. This
document defines the *operational path* — how the team marks a
deprecation, how long it lives, how the drift guard enforces that the
CHANGELOG stays honest, and how the removal lands.

## Scope

Every cross-package shape lives in exactly one of these locations and
is covered by this policy:

| Location | Purpose |
|---|---|
| [`tests/fixtures/retrieval/*-v{n}.schema.json`](../tests/fixtures/retrieval/) | Response envelopes (retrieve, explain, history, review-weekly, propose, promote, deprecate, policy-check, invalidate-git-diff, secret-violation, health) |
| [`schema/*.schema.json`](../schema/) | Configuration surfaces (`.agent-memory.yml`) |

Changes to runtime internals (e.g. repository SQL, trust-score
constants) are **not** in scope. The boundary is "consumer-visible
JSON output or input".

## The four rules

1. **Mark, don't remove.** A deprecated field stays in the schema and
   in production responses for **at least one minor release**. Removal
   is a breaking change and triggers a major bump (ADR-0003 §2).

2. **Mark with both signals.** The JSON Schema property carries both:
   - `"deprecated": true` (JSON Schema 2019-09 keyword; also recognised
     as a hint in draft-07 consumers).
   - `"description"` ending with `" — deprecated in v{X.Y}, removed in
     v{X+1.0}"`. The machine-readable flag drives the drift guard; the
     prose gives humans the removal date.

3. **Announce in CHANGELOG the same release.** The release that first
   ships the deprecation MUST name every newly-deprecated schema in
   its `### Deprecated` section under `## [Unreleased]` (or the
   just-cut version). The drift guard
   [`scripts/check-deprecation-changelog.ts`](../scripts/check-deprecation-changelog.ts)
   blocks CI otherwise.

4. **Window ends with a major bump.** After the documented removal
   version, the field is gone, the schema version (filename
   `*-v{n+1}.schema.json`) ships alongside the legacy file, and
   consumers negotiate via `contract_version` on the envelope. The
   old schema stays in the repo for one major cycle so consumers
   still pinning `v{n}` have a reference.

## Machine-readable shape

Deprecating a field on an existing schema:

```diff
 "properties": {
-  "old_field": { "type": "string" },
+  "old_field": {
+    "type": "string",
+    "deprecated": true,
+    "description": "Use `new_field` instead — deprecated in v1.2, removed in v2.0."
+  },
   "new_field": { "type": "string" }
 }
```

Deprecating a whole envelope (rare — usually only before a major bump):

```diff
 {
   "$id": "…/explain-v1.schema.json",
+  "deprecated": true,
+  "description": "Superseded by explain-v2 — deprecated in v1.3, removed in v2.0.",
   "type": "object",
   …
 }
```

## The drift guard

`npm run check:deprecation-changelog` runs
[`scripts/check-deprecation-changelog.ts`](../scripts/check-deprecation-changelog.ts)
and is wired into the `quality` job. It:

1. Walks `tests/fixtures/retrieval/*.schema.json` and
   `schema/*.schema.json`.
2. Collects every schema that contains at least one `"deprecated": true`
   (at any nesting depth).
3. Requires each such schema's filename (without extension) to appear
   verbatim in the **first `## [...]` block** of `CHANGELOG.md`
   (Unreleased or the most recent release).
4. Exits non-zero with a human-readable diff when a deprecation is
   missing from the CHANGELOG, or when a CHANGELOG mentions a
   deprecation that does not correspond to a flagged schema.

No deprecations today → the guard is a no-op and exits 0. The
regression coverage lives in
[`tests/unit/check-deprecation-changelog.test.ts`](../tests/unit/check-deprecation-changelog.test.ts).

## Release checklist (deprecation edition)

When a PR introduces a deprecation:

- [ ] Schema property (or schema root) carries `"deprecated": true`
      and a description with removal version.
- [ ] `CHANGELOG.md` → `## [Unreleased]` → `### Deprecated` lists the
      schema filename and a one-line migration hint.
- [ ] `npm run check:deprecation-changelog` green locally.
- [ ] If the removal is going to be breaking in 2.x, cross-link from
      [`agents/adrs/0003-contract-version-bumps.md`](../agents/adrs/0003-contract-version-bumps.md).

## Non-goals

- **No compliance claims.** This policy is a contract-stability tool,
  not a certification stance.
- **No auto-generated consumer notices.** Clients read the CHANGELOG
  and the `deprecated` flag on the schema; we don't ship an
  in-response `"deprecations": […]` field today.
- **No runtime-deprecation warnings.** The CLI does not emit a warning
  when a deprecated field is read — that belongs to the consumer's
  own telemetry layer.

## Cross-links

- [ADR-0003 · Contract version bumps](../agents/adrs/0003-contract-version-bumps.md)
- [Compatibility matrix](compatibility-matrix.md)
- [Roadmap · runtime-trust · D5](../agents/roadmaps/runtime-trust.md)
