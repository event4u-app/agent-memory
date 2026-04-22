# Retrieval Contract v1 — Golden Fixtures

Canonical fixtures for the cross-repo retrieval contract defined in
[`agents/roadmaps/from-agent-config/road-to-retrieval-contract.md`](../../../agents/roadmaps/from-agent-config/road-to-retrieval-contract.md).

Both `agent-memory` (backend) and `agent-config` (consumer) test against
these. Drift = bug.

## Files

| File | Purpose |
|---|---|
| `retrieval-v1.schema.json` | JSON Schema (draft-07) for the `retrieve()` envelope |
| `health-v1.schema.json` | JSON Schema (draft-07) for the `health()` envelope |
| `golden-ok.json` | All slices returned — `status: ok` |
| `golden-partial.json` | One slice timed out — `status: partial` |
| `golden-error.json` | Every slice failed — `status: error`, entries empty |
| `golden-health-ok.json` | Healthy backend response |
| `golden-health-error.json` | Backend error / misconfigured response |

## Invariants enforced by the conformance suite

- `contract_version === 1` on every envelope
- `status` in `{ok, partial, error}` for retrieval, `{ok, degraded, error}` for health
- `status: error` ⇒ `entries` is empty
- `status: ok` ⇒ every slice in `slices` has `status: ok`
- `status: partial` ⇒ at least one slice non-ok AND entries non-empty
- Every `entry` has `id`, `type`, `source`, `confidence`, `body`
- Every slice `count` matches the number of entries of that type in the envelope

See `tests/contract/retrieval-contract.test.ts` for the implementation.
