import type postgres from "postgres";

export async function up(sql: postgres.Sql): Promise<void> {
	// Enable pgvector extension
	await sql`CREATE EXTENSION IF NOT EXISTS vector`;

	// Memory entries — core table
	await sql`
    CREATE TABLE IF NOT EXISTS memory_entries (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      summary TEXT NOT NULL,
      details TEXT,
      scope JSONB NOT NULL DEFAULT '{}',
      impact_level TEXT NOT NULL DEFAULT 'normal',
      knowledge_class TEXT NOT NULL DEFAULT 'semi_stable',
      consolidation_tier TEXT NOT NULL DEFAULT 'semantic',
      embedding_text TEXT NOT NULL DEFAULT '',
      embedding vector(384),
      trust_status TEXT NOT NULL DEFAULT 'quarantine',
      trust_score REAL NOT NULL DEFAULT 0.0,
      validated_at TIMESTAMPTZ,
      expires_at TIMESTAMPTZ NOT NULL,
      access_count INTEGER NOT NULL DEFAULT 0,
      last_accessed_at TIMESTAMPTZ,
      created_by TEXT NOT NULL DEFAULT 'agent',
      created_in_task TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

	// Observations — Working Memory (raw tool observations)
	await sql`
    CREATE TABLE IF NOT EXISTS memory_observations (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      session_id TEXT NOT NULL,
      hash TEXT NOT NULL,
      content TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'tool',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

	// Dedup index for observations (SHA-256 hash + time window).
	// NOTE: `created_at::date` is not IMMUTABLE in PG17+ because the session
	// TimeZone can influence the result. Casting through UTC first yields an
	// IMMUTABLE expression that PG accepts in an index.
	await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_observations_hash_window
    ON memory_observations (hash, ((created_at AT TIME ZONE 'UTC')::date))
  `;

	// Episodes — Episodic Memory (session summaries)
	await sql`
    CREATE TABLE IF NOT EXISTS memory_episodes (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      session_id TEXT NOT NULL,
      summary TEXT NOT NULL,
      observation_count INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

	// Evidence — links memory entries to proof
	await sql`
    CREATE TABLE IF NOT EXISTS memory_evidence (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      memory_entry_id UUID NOT NULL REFERENCES memory_entries(id) ON DELETE CASCADE,
      kind TEXT NOT NULL,
      ref TEXT NOT NULL,
      details TEXT,
      verified_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

	// Links — file, symbol, module associations
	await sql`
    CREATE TABLE IF NOT EXISTS memory_links (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      memory_entry_id UUID NOT NULL REFERENCES memory_entries(id) ON DELETE CASCADE,
      link_type TEXT NOT NULL,
      target TEXT NOT NULL,
      signature TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

	// Status history — full audit trail
	await sql`
    CREATE TABLE IF NOT EXISTS memory_status_history (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      memory_entry_id UUID NOT NULL REFERENCES memory_entries(id) ON DELETE CASCADE,
      from_status TEXT NOT NULL,
      to_status TEXT NOT NULL,
      reason TEXT NOT NULL,
      triggered_by TEXT NOT NULL DEFAULT 'system',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

	// Contradictions — pairs of conflicting entries
	await sql`
    CREATE TABLE IF NOT EXISTS memory_contradictions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      entry_a_id UUID NOT NULL REFERENCES memory_entries(id) ON DELETE CASCADE,
      entry_b_id UUID NOT NULL REFERENCES memory_entries(id) ON DELETE CASCADE,
      description TEXT NOT NULL,
      resolved_at TIMESTAMPTZ,
      resolution TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

	// Indexes
	await sql`CREATE INDEX IF NOT EXISTS idx_entries_type ON memory_entries(type)`;
	await sql`CREATE INDEX IF NOT EXISTS idx_entries_status ON memory_entries(trust_status)`;
	await sql`CREATE INDEX IF NOT EXISTS idx_entries_tier ON memory_entries(consolidation_tier)`;
	await sql`CREATE INDEX IF NOT EXISTS idx_entries_expires ON memory_entries(expires_at)`;
	await sql`CREATE INDEX IF NOT EXISTS idx_entries_impact ON memory_entries(impact_level)`;
	await sql`CREATE INDEX IF NOT EXISTS idx_evidence_entry ON memory_evidence(memory_entry_id)`;
	await sql`CREATE INDEX IF NOT EXISTS idx_links_entry ON memory_links(memory_entry_id)`;
	await sql`CREATE INDEX IF NOT EXISTS idx_links_target ON memory_links(target)`;
	await sql`CREATE INDEX IF NOT EXISTS idx_status_history_entry ON memory_status_history(memory_entry_id)`;
	await sql`CREATE INDEX IF NOT EXISTS idx_observations_session ON memory_observations(session_id)`;

	// Migrations tracking table
	await sql`
    CREATE TABLE IF NOT EXISTS memory_migrations (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
}

export async function down(sql: postgres.Sql): Promise<void> {
	await sql`DROP TABLE IF EXISTS memory_contradictions CASCADE`;
	await sql`DROP TABLE IF EXISTS memory_status_history CASCADE`;
	await sql`DROP TABLE IF EXISTS memory_links CASCADE`;
	await sql`DROP TABLE IF EXISTS memory_evidence CASCADE`;
	await sql`DROP TABLE IF EXISTS memory_episodes CASCADE`;
	await sql`DROP TABLE IF EXISTS memory_observations CASCADE`;
	await sql`DROP TABLE IF EXISTS memory_entries CASCADE`;
	await sql`DROP TABLE IF EXISTS memory_migrations CASCADE`;
}
