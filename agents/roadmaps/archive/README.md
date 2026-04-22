# Archived roadmaps

Historical reference only. The specs and roadmaps in this folder have been
**shipped**, **superseded**, or **deferred** (design preserved, not implemented).
Active roadmaps live one level up in [`agents/roadmaps/`](../).

## Contents

### Top-level

| File | Status | Notes |
|---|---|---|
| [`agent-memory-hybrid.md`](agent-memory-hybrid.md) | **Archived — V1 complete** | Master roadmap. All implementable items `[x]`; pilot-only items flagged `[-]` (skipped). If a pilot is scheduled, open a new V2 roadmap instead of reopening this one. |
| [`augment-agent-memory-hybrid-roadmap.md`](augment-agent-memory-hybrid-roadmap.md) | **Superseded** | German-language original, replaced by the agent-agnostic English `agent-memory-hybrid.md` (now also archived, see above). |

### `from-agent-config/` — integration specs authored in agent-config

Shipped via branch `feat/combine-with-agent-config`. Each spec's integration
items are marked `[x]` in the main roadmap.

| Spec | Status | Key artefacts / notes |
|---|---|---|
| [`road-to-agents-md-fix.md`](from-agent-config/road-to-agents-md-fix.md) | **Shipped** `897533d` | `AGENTS.md` rewritten for TypeScript/Node stack |
| [`road-to-retrieval-contract.md`](from-agent-config/road-to-retrieval-contract.md) | **Shipped** `3c5f2b6`, `4d744a6` | `src/retrieval/contract.ts`, JSON schemas, 5 golden fixtures, 20 conformance tests |
| [`road-to-decay-calibration.md`](from-agent-config/road-to-decay-calibration.md) | **Shipped** `c3a94c4`, `e861381` | `src/trust/decay.ts` per-type overrides, retrieval-hit refresh |
| [`road-to-promotion-flow.md`](from-agent-config/road-to-promotion-flow.md) | **Shipped** `ce43233` | `src/trust/promotion.service.ts` — propose/promote/deprecate/prune. Minimum contract shipped; stricter gate criteria (3-future-decisions heuristic, `allowed_target_types`) deferred |
| [`road-to-consumer-integration-guide.md`](from-agent-config/road-to-consumer-integration-guide.md) | **Shipped** `a95823d`, `c96a6e1` | `memory status` / `memory health` CLI, `examples/consumer-*.yml`, README compatibility matrix |
| [`road-to-cross-project-learning.md`](from-agent-config/road-to-cross-project-learning.md) | **Deferred** (not shipped) | Stage-3 cross-project signal feed. Prerequisites (promotion flow in ≥2 production consumers) not met in V1. Design preserved for V2. |

## What is still active (not archived)

- [`../from-agent-config/README.md`](../from-agent-config/README.md) — index of integration specs (now empty; kept as documentation of the spec-ownership split between agent-config and agent-memory).
