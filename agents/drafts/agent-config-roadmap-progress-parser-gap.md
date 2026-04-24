# `roadmap:progress` parser gap — letter and roman phase IDs

**Upstream target:** `@event4u/agent-config` · `.agent-src/scripts/update_roadmap_progress.py`
**Reported from:** `@event4u/agent-memory` (`feat/improve-user-setup`)
**Symptom:** `./agent-config roadmap:progress` writes `0 roadmaps · 0/0 steps done` even though `agents/roadmaps/` contains active roadmaps with checkbox state.

## Root cause

The phase-header regex hard-codes numeric phase IDs:

```python
# .agent-src/scripts/update_roadmap_progress.py  (line ~32)
PHASE_RE = re.compile(
    r"^(#{2,3})\s+Phase\s+(\d+)(?:[\s:\u2014\-]+(.*?))?\s*$",
    re.MULTILINE,
)
```

`\d+` only matches digits. Every file below is a real roadmap, contributes checkboxes, and is silently skipped because `parse_roadmap()` returns `None` when `phase_matches` is empty (line ~132):

| Roadmap | Heading style | Example | Parsed today? |
|---|---|---|---|
| `improve-system.md` (archived) | numeric | `## Phase 0 — Audit & Baseline` | ✅ yes |
| `agent-memory-hybrid.md` (archived) | numeric with colon | `## Phase 0: Scope & Architecture Decisions` | ✅ yes |
| `secret-safety.md` (archived) | **roman** | `## Phase I — Universal Ingress Enforcement` | ❌ no |
| `runtime-trust.md` (active) | **letter** | `## Phase A — Runtime Excellence` | ❌ no |

The numeric-only assumption never surfaced as a bug because the existing consumer (agent-config itself) uses digits. Consumer projects adopt freer conventions — agent-memory uses `A/B/C/D` for concurrent tracks and `I/II/III/IV` for the standalone security track deliberately, so that cross-references like "runtime-trust D1" and "secret-safety III3" don't collide with the numeric phase numbering that `improve-system` already used.

## Proposed fix

### Regex

```python
PHASE_RE = re.compile(
    r"^(#{2,3})\s+Phase\s+"
    r"(\d+|[IVX]+|[A-Z](?:\d+)?)"          # digit, roman numeral, or single uppercase letter (optional trailing digit, e.g. Phase A1)
    r"(?:[\s:\u2014\-]+(.*?))?\s*$",
    re.MULTILINE,
)
```

Rationale for each branch:

- `\d+` — existing numeric phases (`Phase 0`, `Phase 10`).
- `[IVX]+` — roman up to `XXXIX` (39). Intentionally capped: accepting `[IVXLCDM]+` would match plain words that happen to contain those letters in uppercase (e.g. a stray `## Phase LIVE`). Roadmaps that need >XXXIX phases are a design smell.
- `[A-Z](?:\d+)?` — single uppercase letter, optional trailing digit for sub-track IDs (`Phase A`, `Phase A1`). `[A-Z]` (not `[A-Za-z]`) keeps `## Phase overview` (lowercase) a safe no-match — that heading exists in multiple real roadmaps as a non-phase anchor and must continue to be skipped.

### Dataclass change

```python
@dataclass
class PhaseStats:
    id: str            # was: number: int
    name: str
    ...
```

And in `parse_roadmap()`:

```python
phase_id = pm.group(2)                    # was: int(pm.group(2))
name = (pm.group(3) or "").strip() or f"Phase {phase_id}"
stats.phases.append(PhaseStats(phase_id, name, d, o, df, c))
```

`p.number` is only rendered into the per-roadmap table (`render()` line ~204). Renaming `number` → `id` is the only call-site change. No sort key currently uses it — document order from `re.finditer` is preserved.

## Test fixture

Add to the agent-config test suite a fixture with three roadmaps, one per ID style, and assert non-zero phase counts for each:

```markdown
<!-- fixtures/roadmaps/numeric.md -->
# Roadmap — Numeric
## Phase 0 — Setup
- [x] done
- [ ] open
```

```markdown
<!-- fixtures/roadmaps/roman.md -->
# Roadmap — Roman
## Phase I — First
- [x] done
## Phase II — Second
- [ ] open
```

```markdown
<!-- fixtures/roadmaps/letter.md -->
# Roadmap — Letter
## Phase A — Track A
- [x] done
### A1 · Sub · [Must]
- [x] sub-item
## Phase B — Track B
- [ ] open
```

Expected after fix: `collect()` returns three `RoadmapStats`, each with ≥1 phase, totals 4 done / 2 open.

## Regression guard

False-positive check in the same test run — these headings MUST still skip:

```markdown
## Phase overview
## Phase — summary
## Phase 0 fallback that never existed
```

Current regex behavior preserved: the first two don't match (no ID between `Phase` and the separator), the third does match (ID `0`) — which is correct, document order handles it.

## Contributor note

The live repro is `@event4u/agent-memory` on `feat/improve-user-setup` — clone, run `./agent-config roadmap:progress`, observe `0/0`. After applying the regex above, the same command reports the active `runtime-trust.md` with its phase breakdown.
