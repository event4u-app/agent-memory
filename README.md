# @event4u/agent-memory

Persistent, trust-scored project memory for AI coding agents.

## Quick Start

```bash
# Start Postgres
docker compose up -d postgres

# Install dependencies
npm install

# Run migrations
npm run db:migrate

# Use CLI
npx tsx src/cli/index.ts --help
npx tsx src/cli/index.ts retrieve "how are invoices calculated?"
npx tsx src/cli/index.ts health

# Start MCP server (Phase 7)
npm run mcp:start
```

## Architecture

See [ADR-0001](../agent-config/agents/adrs/0001-agent-memory-architecture.md) for all design decisions.
See [Roadmap](../agent-config/agents/roadmaps/agent-memory-hybrid.md) for implementation plan.

## Key Concepts

- **4-Tier Consolidation:** Working → Episodic → Semantic → Procedural
- **Quarantine:** New entries are never directly trusted
- **Ebbinghaus Decay:** Frequently used memories strengthen, unused ones fade
- **Trust Threshold:** Entries below 0.6 score are never served to agents
- **Progressive Disclosure:** 3-layer retrieval for token efficiency
