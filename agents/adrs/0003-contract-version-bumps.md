## ADR-0003: Contract version bumps — when to add, when to break

> **Status:** Accepted
> **Date:** 2026-04-23
> **Roadmap:** `agents/roadmaps/improve-system.md` (P5-3)
> **Related:** `src/retrieval/contract.ts`,
> `agents/roadmaps/archive/from-agent-config/road-to-retrieval-contract.md`,
> `tests/fixtures/retrieval/`.

## Context

`agent-memory` exposes five response surfaces that cross the package
boundary and are consumed by `agent-config` and any other client:

| Surface | Producer | Response type |
|---|---|---|
| `retrieve()` | `RetrieveResponseV1` (`src/retrieval/contract.ts`) | envelope with `contract_version` |
| `health()` | `HealthResponseV1` (`src/retrieval/contract.ts`) | envelope with `contract_version` |
| `propose()` | `ProposeResult` (`src/trust/promotion.service.ts`) | plain object, no envelope |
| `promote()` | `PromoteResult` (`src/trust/promotion.service.ts`) | plain object, no envelope |
| `deprecate()` | `DeprecateResult` (`src/trust/promotion.service.ts`) | plain object, no envelope |

Without a written policy, a field rename, type narrowing, or
nullability flip can ship inside any minor version and silently break
every consumer. The golden-fixture suite added in P5-3 catches the
shape drift at test time; this ADR defines which direction each change
must go.

## Decision

1. **Every cross-package response is versioned by a schema in
   `tests/fixtures/retrieval/*-v1.schema.json`.** The schema is the
   contract; the TypeScript types in `src/` are the producer. The
   contract-builders test keeps them in sync (`ProposeResult` etc. are
   asserted against the schemas).

2. **Two classes of change, two rules:**

   - **Additive (safe in a minor):** new optional field, new enum
     member on an *existing* optional field, new status in a non-exhaustive
     union that consumers already guard. Schema gets updated with
     `additionalProperties: true` preserved; old fixtures stay valid.
     No `contract_version` bump.

   - **Breaking (requires a major bump):** field removal, rename,
     required → optional or optional → required, type narrowing
     (`string` → `"quarantine"`), nullability flip (`string | null`
     → `string`), enum member removal, shape change of a required
     sub-object. The new schema ships as `*-v2.schema.json`, the
     envelope field `contract_version` is bumped to `2`, and the
     previous schema is kept for one major window with consumers still
     receiving v1 responses behind a detection flag.

3. **`propose` / `promote` / `deprecate` are currently un-enveloped.**
   They do **not** carry a `contract_version` field today. Until they
   do, the schema version in the filename (`propose-v1.schema.json`)
   is the authoritative version marker. A future enveloping migration
   MUST be treated as breaking and cleared through §2 rule 2.

4. **Deprecation window.** A deprecated field stays in the schema
   (marked `"deprecated": true` via description) and in production
   responses for one minor release. The next minor removes it — that
   removal is a breaking change and triggers a major bump.

5. **Who can approve.** Additive changes go through normal code
   review. Breaking changes require (a) a `BREAKING CHANGE:` footer
   in the commit, (b) a CHANGELOG migration note, (c) this ADR file
   updated with the new rule row.

## Consequences

- CI fails loudly on any undocumented shape drift (schema validation
  + TypeScript binding in the contract-builders test).
- Adding functionality remains cheap — optional fields flow through
  a single PR.
- Breaking changes are expensive on purpose: separate schema file,
  CHANGELOG entry, deprecation window, optional consumer flag.

## Non-goals

- This ADR does not dictate *internal* type stability. Internal
  repositories, service classes, and DB columns can evolve freely
  as long as the five response shapes above stay contract-clean.
- Feature flags (`BACKEND_FEATURES`) are not contract-versioned —
  they are additive by design and consumers must treat unknown
  features as absent.

## Review trigger

This ADR is revisited when:

- A proposal would introduce a sixth cross-package surface.
- The consumer (`agent-config`) requests a field that requires
  breaking shape.
- A security fix requires removing a field that is currently emitted.
