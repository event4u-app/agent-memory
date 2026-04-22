# CLI Reference

All commands emit **pure JSON on stdout**, logs on stderr — safe for piping,
scripts, and MCP wrappers. Exit code is `0` on success, non-zero on error.

```bash
# Local dev
npx tsx src/cli/index.ts <command> [options]

# After npm run build + npm install -g
memory <command> [options]
```

## Retrieval

### `retrieve <query>`

Query memory for relevant entries. Returns a contract v1 envelope.

```bash
memory retrieve "how are invoices calculated?" \
  --layer 2 --budget 2000 --limit 10 --repository my-app
```

| Option | Default | Notes |
|---|---|---|
| `--layer <n>` | `2` | `1` = index, `2` = summary, `3` = full details |
| `--budget <tokens>` | `2000` | max total token budget |
| `--limit <n>` | — | cap result count |
| `--low-trust` | off | include stale / low-score entries, marked in response |
| `--type <t>` | — | filter by memory type (repeatable) |
| `--repository <id>` | — | scope to one repository |

## Ingestion & Promotion

### `ingest` — direct quarantined entry

One-shot: create → quarantine. Parity with `mcp.memory_ingest`.

```bash
memory ingest \
  --type architecture_decision \
  --title "Use event sourcing for order aggregate" \
  --summary "All order state changes go through domain events." \
  --repository my-app \
  --file src/order/aggregate.ts --symbol Order
```

Required: `--type --title --summary --repository`. Optional: `--details --file --symbol --module --impact --knowledge-class`.

### `propose` — create with gate inputs

Like `ingest` but records proposal metadata used by `promote`.

```bash
memory propose --type bug_pattern --title "N+1 on invoice list" \
  --summary "..." --repository my-app \
  --source "incident-42" --confidence 0.7 \
  --scenario "paginated-list" --scenario "export"
```

Required: `--source --confidence`. Accepts repeatable `--scenario`.

### `promote <proposal-id>`

Move a quarantined proposal through gate criteria. The proposal ID is
the `id` field returned by `propose`.

```bash
memory promote <proposal-id>
memory promote <proposal-id> --allowed-type architecture_decision --allowed-type coding_convention
memory promote <proposal-id> --skip-duplicate-check
```

| Option | Default | Notes |
|---|---|---|
| `--allowed-type <type>` | — | consumer-policy allow-list (repeatable) |
| `--skip-duplicate-check` | off | caller accepts an existing sibling entry |
| `--triggered-by <actor>` | `cli:promote` | caller identifier for audit |

Fails with a structured error if any gate is not satisfied (missing evidence,
<3 future decisions, disallowed target type, duplicate without `--skip-duplicate-check`).

### `validate <entry-id>`

Re-run file / symbol / diff / test validators against an entry. Does not
change status unless all validators agree.

## Invalidation & Rollback

### `invalidate`

Mark an entry or a set of entries as stale (soft) or invalidated (hard).

```bash
# Single entry, soft
memory invalidate --entry <uuid> --reason "superseded by ADR-019"

# Hard invalidation (fully wrong)
memory invalidate --entry <uuid> --hard --reason "function deleted"

# Bulk from git diff
memory invalidate --from-git-diff --from-ref main --to-ref HEAD
```

### `poison <entry-id>`

Confirm entry is wrong. Triggers cascade review of every entry derived from
it via evidence links. Writes a rollback report.

### `rollback <entry-id>`

Report + invalidate every task influenced by a poisoned entry.
See [`src/invalidation/rollback.ts`](../src/invalidation/rollback.ts) for
the report shape.

### `verify <entry-id>`

Trace an entry back to its source evidence. Returns a provenance chain:
entry → evidence refs → upstream entries that cite the same ref.

## Observability

### `health`

Backend health probe. Returns contract v1 envelope with `status`, `features[]`,
`backend_version`. Exit code 0 = healthy, non-zero = fail. Use in CI to gate
deploys.

```bash
memory health --timeout 2000
```

### `status`

Lightweight liveness check for consumers. Prints `present | absent | misconfigured`.

```bash
memory status               # exit 0, stdout = one word
memory status --json        # full envelope, always exits 0
```

### `diagnose`

List stale entries, low-trust entries, and known contradictions.

```bash
memory diagnose --max-results 20
```

## Pattern: piping

Every command emits JSON — compose with `jq`:

```bash
memory retrieve "auth flow" --layer 3 | jq '.data.entries[].title'
memory health | jq -e '.data.status == "ok"'   # 0 if healthy
```
