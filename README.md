# @event4u/agent-memory

Persistent, trust-scored project memory for AI coding agents — delivered as an MCP server with 17 tools.

## Quick Start

```bash
# Start Postgres
docker compose up -d postgres

# Install dependencies
npm install

# Run migrations
npm run db:migrate

# Start MCP server (stdio transport)
npm run mcp:start

# Or use CLI directly
npx tsx src/cli/index.ts retrieve "how are invoices calculated?"
npx tsx src/cli/index.ts health
```

### Connect to your AI agent

Add to your agent's MCP config (e.g. `claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "agent-memory": {
      "command": "npx",
      "args": ["tsx", "src/mcp/server.ts"],
      "env": {
        "DATABASE_URL": "postgresql://memory:memory_dev@localhost:5433/agent_memory",
        "REPO_ROOT": "/path/to/your/project"
      }
    }
  }
}
```

## Architecture

See [Roadmap](agents/roadmaps/agent-memory-hybrid.md) for the full implementation plan.

### Key Concepts

- **4-Tier Consolidation:** Working → Episodic → Semantic → Procedural
- **Quarantine:** New entries are never directly trusted — must pass evidence validation
- **Ebbinghaus Decay:** Frequently used memories strengthen, unused ones fade
- **Trust Threshold:** Entries below 0.6 score are never served (configurable)
- **Progressive Disclosure:** 3-layer retrieval (L1 index / L2 timeline / L3 full) for token efficiency
- **Privacy by Default:** All content runs through privacy filter before storage (secrets, PII, env vars)
- **Invalidation Engine:** Code changes auto-detect stale memories via git diff + semantic drift

### Trust Lifecycle

```
  quarantine → validated → stale → invalidated → archived
       ↓                     ↓
    rejected              poisoned (cascade)
```

## MCP Tools (17)

### Core

| Tool | Description |
|---|---|
| `memory_retrieve` | Query with progressive disclosure (L1/L2/L3), token budget, filters |
| `memory_retrieve_details` | Full Layer 3 details for specific entry IDs |
| `memory_ingest` | Create new entry (enters quarantine, needs validation) |
| `memory_validate` | Trigger evidence validation for quarantined entry |
| `memory_invalidate` | Mark entry as stale (soft) or invalidated (hard) |
| `memory_poison` | Mark as confirmed wrong — triggers cascade review |
| `memory_verify` | Trace entry back to source evidence (citation provenance) |

### Lifecycle

| Tool | Description |
|---|---|
| `memory_session_start` | Call at session start — injects context + runs TTL expiry |
| `memory_observe` | Record observation from tool use (Working Memory, deduped) |
| `memory_session_end` | Consolidate Working→Episodic, run revalidation |
| `memory_run_invalidation` | Check code changes against memory (git-based) |

### Quality & Review

| Tool | Description |
|---|---|
| `memory_health` | System health + quality metrics |
| `memory_diagnose` | Identify issues: stale, low trust, contradictions |
| `memory_audit` | Full entry history: status changes, evidence, access patterns |
| `memory_review` | Dashboard: metrics, stale entries, contradictions, duplicates |
| `memory_resolve_contradiction` | Resolve with keep_a / keep_b / keep_both / reject_both |
| `memory_merge_duplicates` | Merge near-duplicates, transfer evidence to survivor |

## Project Structure

```
src/
├── config.ts                 # Configuration with env var overrides
├── types.ts                  # Core types, enums, trust lifecycle
├── db/
│   ├── connection.ts         # Postgres connection pool
│   ├── migrations/           # SQL migrations
│   └── repositories/         # Data access (entries, evidence, contradictions, observations)
├── retrieval/
│   ├── engine.ts             # Hybrid retrieval: BM25 + vector + RRF fusion + trust ranking
│   ├── bm25.ts               # Lexical search
│   ├── vector-search.ts      # Cosine similarity
│   ├── rrf-fusion.ts         # Reciprocal Rank Fusion
│   └── progressive-disclosure.ts  # L1/L2/L3 token budgeting
├── trust/
│   ├── scoring.ts            # Trust score calculation
│   ├── transitions.ts        # Status transition rules
│   ├── quarantine.service.ts # Quarantine validation flow
│   ├── contradiction.service.ts   # Detect overlapping contradictions
│   ├── poison.service.ts     # Poison cascade
│   └── validators/           # File-exists, symbol-exists, diff-impact, test-linked
├── ingestion/
│   ├── privacy-filter.ts     # Strip secrets, PII, env vars, private tags
│   ├── candidate.ts          # Candidate model + auto-classification
│   ├── extraction-guard.ts   # Block extraction if tests fail
│   ├── pipeline.ts           # Full ingestion orchestrator
│   └── scanners/             # File scanner, doc reader, git reader, symbol extractor
├── consolidation/
│   ├── working-to-episodic.ts    # Session observations → summary
│   ├── episodic-to-semantic.ts   # Extract stable knowledge
│   └── tier-promotion.ts        # Promotion rules
├── invalidation/
│   ├── git-diff.ts           # Structured git diff reader
│   ├── watchers.ts           # File/symbol/module watch matching
│   ├── semantic-drift.ts     # Signature comparison
│   ├── invalidation-flows.ts # Soft (stale) + hard (invalidated) flows
│   ├── ttl-expiry-job.ts     # Auto-stale expired entries
│   ├── revalidation-job.ts   # Re-run validators on stale entries
│   ├── rollback.ts           # Poison + affected task report
│   └── orchestrator.ts       # Ties all invalidation together
├── quality/
│   ├── metrics.ts            # System-wide quality metrics
│   ├── dedup.ts              # Duplicate detection + merge
│   ├── contradiction-resolution.ts  # Resolution strategies
│   ├── archival.ts           # Auto-archive + purge
│   └── export.ts             # Snapshot export + diff
├── security/
│   └── access-scope.ts       # Repository isolation, scope validation
└── mcp/
    ├── server.ts             # MCP server entry (stdio transport)
    ├── tool-definitions.ts   # 17 tool schemas (JSON Schema)
    ├── tool-handlers.ts      # Tool call router + implementations
    └── lifecycle.ts          # Future: notifications, resources
```

## Configuration

All settings have sensible defaults. Override via environment variables:

| Variable | Default | Description |
|---|---|---|
| `DATABASE_URL` | `postgresql://...localhost:5433/agent_memory` | Postgres connection |
| `REPO_ROOT` | `process.cwd()` | Repository root for file/symbol validators |
| `MEMORY_TRUST_THRESHOLD_DEFAULT` | `0.6` | Minimum trust score for retrieval |
| `MEMORY_TRUST_THRESHOLD_LOW` | `0.3` | Threshold in low-trust mode |
| `MEMORY_TOKEN_BUDGET` | `2000` | Default token budget for retrieval |
| `MEMORY_ARCHIVAL_AGE_DAYS` | `30` | Days before auto-archiving invalidated entries |
| `MEMORY_PURGE_AGE_DAYS` | `90` | Days before hard-deleting archived entries |
| `LOG_LEVEL` | `info` | Log level (debug, info, warn, error) |
| `LOG_FORMAT` | `json` | Log format (json, pretty) |

## Testing

```bash
npm test                # Run all 176 tests
npm run test:watch      # Watch mode
npm run typecheck       # TypeScript strict check
```
