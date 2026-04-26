# Data Portability — `memory export` & `memory import`

> **Status:** stable · contract `export-v1` · redaction `v1`
> **Roadmap:** [`runtime-trust.md` · D1](../agents/roadmaps/archive/runtime-trust.md#d1--datenportabilität--must--✅-shipped) · [`secret-safety.md` · III3](../agents/roadmaps/archive/secret-safety.md#iii3--export-pfad-mit-redaction-metadata--must--✅-shipped)
> **Contract:** [`tests/fixtures/retrieval/export-v1.schema.json`](../tests/fixtures/retrieval/export-v1.schema.json) · pinned by [`tests/contract/export-v1-contract.test.ts`](../tests/contract/export-v1-contract.test.ts)

## Why this exists

"Institutional memory" locked to one database host is vendor lock-in with
the wrong sign — the team loses, not the vendor. `memory export` writes
every validated, quarantined, deprecated, and poisoned entry to a
JSONL stream that any `memory import` (same version or forward-compatible)
can re-ingest with preserved IDs, trust state, timestamps, evidence, and
full audit-event history.

Three concrete use cases drive the design:

1. **Backup / restore.** Nightly `memory export > backups/$(date +%F).jsonl`
   is an immutable audit copy no `DROP TABLE` can undo.
2. **Migration between DB hosts.** Move from `agent_memory@prod-rds` to
   `agent_memory@self-hosted-pg` without dump/restore coupling you to
   a specific Postgres version. Export on the old host, import on the new.
3. **Team-stand separation.** A consultant working on two clients keeps
   two exports. `memory import --on-conflict fail` refuses to mix them;
   `--on-conflict skip` treats the target as authoritative.

D4 · Migrations-Importer piggy-backs on the same pipeline — translate
foreign tools into `export-v1` JSONL, `memory import` does the rest.

## The file format — `export-v1`

JSONL — one JSON object per line, newline-terminated. The **first
non-empty line is the header**; every remaining non-empty line is an
entry. Blank lines are tolerated (trailing newline is the common case).

### Header line

```json
{
  "kind": "header",
  "contract_version": "export-v1",
  "exported_at": "2026-04-24T00:00:00.000Z",
  "entry_count": 42,
  "filters": { "since": null, "repository": "acme/checkout" },
  "redaction_version": "1"
}
```

- `contract_version` and `redaction_version` are **refused** on import
  if they don't match the running binary's expectations — that's the
  forward-compat boundary.
- `entry_count` is pinned against the actual entry-line count — a
  mismatch raises `entry_count mismatch: header=X, actual=Y` before any
  write.

### Entry line

Each line is self-contained: the memory entry, every piece of evidence,
and every audit event that happened to it.

```json
{
  "kind": "entry",
  "entry": { "id": "…", "type": "…", "title": "…", "scope": {…}, "trust": {…}, … },
  "evidence": [ { "id": "…", "kind": "file", "ref": "src/billing/invoice.ts", … } ],
  "events": [ { "event_type": "entry_proposed", "actor": "agent", … }, … ],
  "redaction": { "applied": false, "patterns": [], "version": "1" }
}
```

Field order is **fixed on purpose** — `JSON.stringify` honours insertion
order, and the contract test compares byte-level equality via
`formatLine()` → `parseExportJsonl()` → `formatLine()`. Any re-ordering
of keys in `src/export/serialize.ts` breaks the test on purpose; that's
how you know the schema is the source of truth, not the Postgres
column order.

## Redaction — what gets scrubbed on export

The export pipeline runs the same `SECRET_DETECTED` patterns used by
retrieval (`src/security/secret-patterns.ts`, catalog version
[pinned in `secret-patterns.ts`](../src/security/secret-patterns.ts))
across:

- `entry.title`, `entry.summary`, `entry.details`, `entry.embedding_text`
- `evidence[*].ref`, `evidence[*].details`
- `events[*].reason`

Hits are replaced with `[REDACTED:retrieve]` (deliberately shared with the
retrieval marker — single vocabulary, single mental model). Each entry
line carries a `redaction` envelope that names every pattern that fired.

**Out of scope (documented):** `events[*].metadata`, `events[*].before`,
`events[*].after` are **not** scanned. These carry trust-layer state
snapshots, not user content. Widening coverage there would require a
schema-aware walker (future roadmap III*).

## Import — conflict resolution

```
memory import <file> [--on-conflict fail|update|skip]
```

| Mode | Entry exists | Entry is new |
|---|---|---|
| `fail` (default) | `ImportConflictError` — no writes | Insert |
| `update` | Delete children + row, re-insert from file (single tx) | Insert |
| `skip` | Leave existing row untouched | Insert |

Each entry + its evidence + events land in a single transaction so a
mid-file failure never leaves a half-imported row in the store.

### Import-side secret guard (III3)

An incoming entry line that claims `redaction.applied: false` is
**re-scanned** with the current `SECRET_PATTERNS` catalog before any
write. If the scanner finds a hit that the exporter missed (older
exporter, catalog added a pattern since the file was produced), the
import aborts with `ImportSecretLeakError` — the export file is
quarantined, the DB is untouched. This is the belt-and-braces case
against a stale exporter leaking secrets back into a fresh store.

## Typical workflows

### Nightly backup

```bash
mkdir -p backups
memory export > "backups/$(date -u +%Y-%m-%d).jsonl"
# rotate — keep last 30
ls -t backups/*.jsonl | tail -n +31 | xargs -r rm
```

### DB-host migration

```bash
# On old host
memory export > /tmp/memory-snapshot.jsonl

# On new host — fresh DB, migrations already applied
memory import /tmp/memory-snapshot.jsonl --on-conflict fail
```

`fail` is the right choice here — any pre-existing entry on the new
host means migration already happened once and you'd be double-importing.

### Selective repository export

```bash
memory export --repository acme/checkout --since 2026-01-01 \
  > acme-checkout-2026.jsonl
```

### Round-trip integrity check

```bash
memory export > /tmp/a.jsonl
memory import /tmp/a.jsonl --on-conflict update
memory export > /tmp/b.jsonl
diff /tmp/a.jsonl /tmp/b.jsonl   # must be empty
```

Byte-identical round-trip is pinned by the contract test against the
golden fixture; the live-DB variant above is the operator-facing
confirmation.

## Troubleshooting

| Error | Meaning | Recovery |
|---|---|---|
| `schema validation failed: …` | File doesn't match `export-v1.schema.json`. | Check `contract_version` + `redaction_version` in the header. Downgrade, or run a translator. |
| `entry_count mismatch: header=X, actual=Y` | File was truncated or concatenated incorrectly. | Re-export; never hand-edit JSONL. |
| `ImportConflictError: entry already exists: <id>` | Target DB already has this entry id. | Pick `--on-conflict update` or `skip`; `fail` is the safe default. |
| `ImportSecretLeakError: … (id=<id>)` | An entry claimed `redaction.applied=false` but the current scanner caught a secret. | Re-export with the current binary (secret gets redacted), then re-import. |
| `unsupported contract_version: …` | File was written by a newer/older incompatible exporter. | Upgrade/downgrade `agent-memory` to match; no silent compat window. |

## Stability contract

- **`export-v1`** is frozen. Field order, presence, and types are
  pinned by `tests/fixtures/retrieval/export-v1.schema.json` +
  `tests/fixtures/retrieval/golden-export.jsonl`.
- Any additive field must ship in `export-v2` with a header bump. No
  silent schema drift.
- Deprecation follows [`docs/deprecation-policy.md`](deprecation-policy.md)
  — one minor as warning, next major as hard-fail.
