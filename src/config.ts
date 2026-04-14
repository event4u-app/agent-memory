import { env } from "node:process";

export const config = {
  database: {
    url: env.DATABASE_URL ?? "postgresql://memory:memory_dev@localhost:5433/agent_memory",
    urlTest: env.DATABASE_URL_TEST ?? "postgresql://memory:memory_dev@localhost:5434/agent_memory_test",
  },
  embedding: {
    provider: (env.EMBEDDING_PROVIDER ?? "bm25-only") as "local" | "gemini" | "openai" | "voyage" | "bm25-only",
    geminiApiKey: env.GEMINI_API_KEY,
    openaiApiKey: env.OPENAI_API_KEY,
    voyageApiKey: env.VOYAGE_API_KEY,
  },
  trust: {
    thresholdDefault: parseFloat(env.MEMORY_TRUST_THRESHOLD_DEFAULT ?? "0.6"),
    thresholdLow: parseFloat(env.MEMORY_TRUST_THRESHOLD_LOW ?? "0.3"),
  },
  tokenBudget: parseInt(env.MEMORY_TOKEN_BUDGET ?? "2000", 10),
  mcp: {
    port: parseInt(env.MCP_PORT ?? "3100", 10),
  },
  log: {
    level: env.LOG_LEVEL ?? "info",
    format: (env.LOG_FORMAT ?? "json") as "json" | "pretty",
  },
} as const;
