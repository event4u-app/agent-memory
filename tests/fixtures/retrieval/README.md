# Retrieval Contract v1 — Golden Fixtures

Canonical fixtures for the cross-repo retrieval contract defined in
[`agents/roadmaps/archive/from-agent-config/road-to-retrieval-contract.md`](../../../agents/roadmaps/archive/from-agent-config/road-to-retrieval-contract.md).

Both `agent-memory` (backend) and `agent-config` (consumer) test against
these. Drift = bug.

Contract version bump policy: [`agents/adrs/0003-contract-version-bumps.md`](../../../agents/adrs/0003-contract-version-bumps.md).

## Files

### `retrieve()` + `health()`

| File | Purpose |
|---|---|
| `retrieval-v1.schema.json` | JSON Schema (draft-07) for the `retrieve()` envelope |
| `health-v1.schema.json` | JSON Schema (draft-07) for the `health()` envelope |
| `golden-ok.json` | All slices returned — `status: ok` |
| `golden-partial.json` | One slice timed out — `status: partial` |
| `golden-error.json` | Every slice failed — `status: error`, entries empty |
| `golden-health-ok.json` | Healthy backend response |
| `golden-health-error.json` | Backend error / misconfigured response |

### `propose()` / `promote()` / `deprecate()`

| File | Purpose |
|---|---|
| `propose-v1.schema.json` | JSON Schema for `PromotionService.propose()` result |
| `promote-v1.schema.json` | JSON Schema for `PromotionService.promote()` result (validated or rejected) |
| `deprecate-v1.schema.json` | JSON Schema for `PromotionService.deprecate()` result |
| `golden-propose.json` | Typical proposal — status `quarantine` |
| `golden-promote-validated.json` | Promotion passed every gate — status `validated` |
| `golden-promote-rejected.json` | Promotion rejected on duplicate gate — carries `existing_id` |
| `golden-deprecate.json` | Manual deprecation without successor |
| `golden-deprecate-with-successor.json` | Deprecation with `superseded_by` |

## Invariants enforced by the conformance suite

**Retrieval envelope (`retrieve()`)**

- `contract_version === 1` on every envelope
- `status` in `{ok, partial, error}`; health uses `{ok, degraded, error}`
- `status: error` ⇒ `entries` is empty
- `status: ok` ⇒ every slice in `slices` has `status: ok`
- `status: partial` ⇒ at least one slice non-ok AND entries non-empty
- Every `entry` has `id`, `type`, `source`, `confidence`, `body`
- Every slice `count` matches the number of entries of that type

**Promotion surfaces (`propose` / `promote` / `deprecate`)**

- `propose` always returns `status: "quarantine"` and `trust_score ∈ [0, 1]`
- `promote` returns `status ∈ {validated, rejected}`; rejections MUST carry
  `rejection_reason` from the 7-value enum; duplicate rejections MUST carry
  `existing_id`
- `deprecate` always returns `status: "invalidated"`; `superseded_by` is
  either a string id or explicit `null` (never missing)
- TypeScript producer types (`ProposeResult`, `PromoteResult`,
  `DeprecateResult`) are asserted against the schemas as a drift guard

## Running

```bash
npm run test:contract   # runs only tests/contract/**
npm test                # full suite, includes contract tests
```

Implementation: `tests/contract/retrieval-contract.test.ts`,
`tests/contract/promotion-contract.test.ts`,
`tests/contract/contract-builders.test.ts`.
