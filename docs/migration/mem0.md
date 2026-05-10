# Migrating from Mem0

This page documents the **Mem0 → agent-memory** import adapter shipped in
D4 (`runtime-trust`). It moves a Mem0 memory store into agent-memory in
one shot using the existing `memory import` CLI.

## What this adapter is — and is not

- **Is**: a one-way mapper from per-record Mem0 JSON (the shape returned
  by `client.get_all()` or `mem0 list --json`) into agent-memory's
  `export-v1` envelope, fed through the same `importEntries()` pipeline
  used by native exports.
- **Is not**: a live sync, a two-way bridge, or a lossless round-trip.
  Mem0 has no concept of repository scope, evidence, or trust state, so
  every imported entry starts with neutral defaults and must earn trust
  through normal usage (access frequency, evidence verification).

## Source format

Mem0 exposes no canonical export envelope — the platform supports
user-defined Pydantic schemas for filtered exports, which is unsuitable
for verbatim migration. The adapter therefore accepts **JSONL with one
Mem0 record per line** in the shape returned by the platform's per-item
APIs:

```json
{"id":"…","memory":"…","created_at":"…","categories":["…"],"metadata":{}}
```

Recommended export command from a Mem0-using project:

```bash
mem0 list --json | jq -c '.data[]' > mem0-export.jsonl
```

Either of `memory`, `text`, or `content` is accepted as the text field
(matching the `mem0 import` CLI tolerance).

## CLI usage

```bash
memory import mem0-export.jsonl \
  --from mem0-jsonl \
  --repository acme/web \
  --initial-trust 0.5
```

Available flags for non-native imports:

| Flag | Required | Default | Purpose |
|---|---|---|---|
| `--from` | yes | `agent-memory-v1` | Set to `mem0-jsonl` for this adapter |
| `--repository` | yes | — | Target repository scope (Mem0 has none) |
| `--initial-trust` | no | `0.5` | Trust score in `[0, 1]` |
| `--quarantine` | no | off | Import as `quarantine` instead of `validated` |
| `--on-conflict` | no | `fail` | `fail | update | skip` (same as native imports) |

## Mapping table

| Mem0 field | agent-memory field | Notes |
|---|---|---|
| `memory` / `text` / `content` | `entry.summary`, `entry.embedding_text` | Full text, untouched |
| (derived from text) | `entry.title` | First sentence or first 80 chars + `…` |
| `id` | `entry.promotion_metadata.mem0_id` | Original Mem0 ID is preserved as provenance; agent-memory generates a fresh UUID for `entry.id` |
| `created_at` | `entry.created_at` | Falls back to import time if missing |
| `updated_at` | `entry.updated_at` | Falls back to import time if missing |
| `categories` | `entry.details` (JSON) | Stored verbatim; not used for routing |
| `metadata` | `entry.details` (JSON) | Lossless preserve under `metadata` key |
| `user_id`/`agent_id`/`app_id`/`run_id` | `entry.details` (JSON) | Lossless preserve |
| (full record) | `entry.promotion_metadata.mem0_raw` | Full original record retained for re-mapping |
| (synthesised) | `entry.scope.repository` | From `--repository` flag |
| (synthesised) | `entry.type` | Defaults to `coding_convention` (most generic) |
| (synthesised) | `entry.impact_level` | Defaults to `low` |
| (synthesised) | `entry.knowledge_class` | Defaults to `semi_stable` |
| (synthesised) | `entry.consolidation_tier` | Defaults to `semantic` |
| (synthesised) | `entry.trust.status` | `validated` (or `quarantine` with flag) |
| (synthesised) | `entry.trust.score` | From `--initial-trust` |
| (synthesised) | `entry.trust.expires_at` | Now + 30d (semi_stable TTL) |
| (synthesised) | `entry.created_by` | `import:mem0` |

## Trust policy

Mem0 entries default to `validated` rather than `quarantine`. Rationale:
they were already accepted by the source system, so requiring manual
re-promotion for every record (potentially thousands) would block the
migration use case in practice. The adapter still:

- Caps the initial trust score at `0.5` by default — well below the
  retrieval threshold of `0.6`, so imported entries are **indexed but
  not retrieved** until they prove themselves through access frequency.
- Records `imported_from: "mem0"` in `promotion_metadata` so
  trust-curation tooling can distinguish migrated entries from native
  ones.
- Honours `--quarantine` for security-conscious users who want every
  record to flow through the standard quarantine gate.

## Safety guarantees

- **Same secret scanner**: imported entries pass through
  `verifyNoSecretLeak()` like native imports. Records carrying live
  AWS keys or OpenAI tokens abort the import (no partial writes).
- **Same conflict policy**: `--on-conflict fail|update|skip` works
  identically. Conflicts compare on `entry.id` (the new agent-memory
  UUID), not on `mem0_id`, so re-running the importer creates fresh
  rows unless you supply your own `id` mapping.
- **Schema-validated**: mapper output is re-validated against
  `export-v1.schema.json` before any DB write — same Ajv pass that
  native imports use.

## What you lose

| Lost | Why |
|---|---|
| Mem0 evidence linkage | Mem0 has no equivalent; imported entries start with `evidence: []` |
| Mem0 history / events | Status changes don't translate; `events: []` |
| Mem0 embeddings | agent-memory generates its own on demand |
| Per-record repository | Mem0 is user-scoped; one `--repository` per import |
| Inferred entry type | Defaults to `coding_convention` — re-classify post-import if needed |

## Re-mapping later

The full original Mem0 record is preserved verbatim in
`entry.promotion_metadata.mem0_raw`. A future, smarter mapper (e.g.
type inference from category names) can reprocess imports without
touching the source system again.
