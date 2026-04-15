import type { Tool } from "@modelcontextprotocol/sdk/types.js";

/**
 * All MCP tool definitions. JSON Schema based (not Zod — SDK v1 requirement).
 */
export const TOOL_DEFINITIONS: Tool[] = [
  {
    name: "memory_retrieve",
    description: "Retrieve relevant memory entries for a query. Returns progressive disclosure (L1 index by default).",
    inputSchema: {
      type: "object" as const,
      properties: {
        query: { type: "string", description: "Natural language query" },
        level: { type: "string", enum: ["L1", "L2", "L3"], default: "L1", description: "Disclosure level" },
        tokenBudget: { type: "number", default: 2000, description: "Max tokens to return" },
        repository: { type: "string", description: "Filter by repository name" },
        lowTrustMode: { type: "boolean", default: false, description: "Include lower-trust entries" },
      },
      required: ["query"],
    },
  },
  {
    name: "memory_retrieve_details",
    description: "Get full Layer 3 details for specific memory entry IDs.",
    inputSchema: {
      type: "object" as const,
      properties: {
        ids: { type: "array", items: { type: "string" }, description: "Entry IDs to retrieve" },
      },
      required: ["ids"],
    },
  },
  {
    name: "memory_ingest",
    description: "Create a new memory entry (enters quarantine). Requires validation before serving.",
    inputSchema: {
      type: "object" as const,
      properties: {
        type: { type: "string", description: "Memory type" },
        title: { type: "string", description: "Short title" },
        summary: { type: "string", description: "One-paragraph summary" },
        details: { type: "string", description: "Optional longer details" },
        repository: { type: "string", description: "Repository name" },
        files: { type: "array", items: { type: "string" }, default: [] },
        symbols: { type: "array", items: { type: "string" }, default: [] },
        modules: { type: "array", items: { type: "string" }, default: [] },
        impactLevel: { type: "string", default: "normal" },
        knowledgeClass: { type: "string", default: "semi_stable" },
      },
      required: ["type", "title", "summary", "repository"],
    },
  },
  {
    name: "memory_validate",
    description: "Trigger validation for a quarantined entry.",
    inputSchema: {
      type: "object" as const,
      properties: { id: { type: "string", description: "Entry ID to validate" } },
      required: ["id"],
    },
  },
  {
    name: "memory_invalidate",
    description: "Mark an entry as stale (soft) or invalidated (hard).",
    inputSchema: {
      type: "object" as const,
      properties: {
        id: { type: "string", description: "Entry ID" },
        mode: { type: "string", enum: ["soft", "hard"], default: "soft" },
        reason: { type: "string", description: "Why this entry is being invalidated" },
      },
      required: ["id", "reason"],
    },
  },
  {
    name: "memory_poison",
    description: "Mark an entry as confirmed wrong. Triggers cascade review of related entries.",
    inputSchema: {
      type: "object" as const,
      properties: {
        id: { type: "string", description: "Entry ID to poison" },
        reason: { type: "string", description: "Why this entry is wrong" },
      },
      required: ["id", "reason"],
    },
  },
  {
    name: "memory_verify",
    description: "Trace an entry back to its source evidence (citation provenance).",
    inputSchema: {
      type: "object" as const,
      properties: { id: { type: "string", description: "Entry ID to verify" } },
      required: ["id"],
    },
  },
  {
    name: "memory_health",
    description: "Show system health and quality metrics.",
    inputSchema: { type: "object" as const, properties: {} },
  },
  {
    name: "memory_diagnose",
    description: "Identify issues: stale entries, low trust, unresolved contradictions.",
    inputSchema: {
      type: "object" as const,
      properties: { maxResults: { type: "number", default: 10 } },
    },
  },
  {
    name: "memory_session_start",
    description: "Call at session start. Returns relevant context and runs TTL expiry.",
    inputSchema: {
      type: "object" as const,
      properties: {
        query: { type: "string", default: "", description: "Task description or context hint" },
        repository: { type: "string", description: "Current repository name" },
        sessionId: { type: "string", description: "Unique session identifier" },
        tokenBudget: { type: "number", default: 2000 },
      },
      required: ["repository", "sessionId"],
    },
  },
  {
    name: "memory_observe",
    description: "Record an observation from tool use (Working Memory). Deduped by content hash.",
    inputSchema: {
      type: "object" as const,
      properties: {
        sessionId: { type: "string", description: "Current session ID" },
        content: { type: "string", description: "What was observed (will be privacy-filtered)" },
        source: { type: "string", default: "tool-use" },
      },
      required: ["sessionId", "content"],
    },
  },
  {
    name: "memory_session_end",
    description: "Call at session end. Consolidates Working→Episodic memory and runs revalidation.",
    inputSchema: {
      type: "object" as const,
      properties: {
        sessionId: { type: "string" },
        repository: { type: "string" },
      },
      required: ["sessionId", "repository"],
    },
  },
  {
    name: "memory_run_invalidation",
    description: "Run invalidation check against recent code changes.",
    inputSchema: {
      type: "object" as const,
      properties: {
        fromRef: { type: "string", description: "Git ref to compare from" },
        sinceDate: { type: "string", description: "Or: check changes since date (ISO)" },
      },
    },
  },
  {
    name: "memory_audit",
    description: "Full history of an entry: status changes, evidence, contradictions, access patterns.",
    inputSchema: {
      type: "object" as const,
      properties: { id: { type: "string", description: "Entry ID to audit" } },
      required: ["id"],
    },
  },
  {
    name: "memory_review",
    description: "List questionable entries for human review: low trust, stale, contradictions, duplicates.",
    inputSchema: {
      type: "object" as const,
      properties: { maxResults: { type: "number", default: 10 } },
    },
  },
  {
    name: "memory_resolve_contradiction",
    description: "Resolve a contradiction between two entries.",
    inputSchema: {
      type: "object" as const,
      properties: {
        contradictionId: { type: "string", description: "Contradiction ID" },
        strategy: { type: "string", enum: ["keep_a", "keep_b", "keep_both", "reject_both"], description: "Resolution strategy" },
      },
      required: ["contradictionId", "strategy"],
    },
  },
  {
    name: "memory_merge_duplicates",
    description: "Merge duplicate entries: keep highest-trust entry, archive others, transfer evidence.",
    inputSchema: {
      type: "object" as const,
      properties: {
        entryIds: { type: "array", items: { type: "string" }, description: "Entry IDs to merge (min 2)" },
      },
      required: ["entryIds"],
    },
  },
];
