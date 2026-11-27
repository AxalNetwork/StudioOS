-- Competitor Analysis feature — canonical D1 schema.
-- Apply via:
--   npx wrangler d1 execute studioos-db --config ../wrangler.toml --remote \
--     --file=cloudflare-worker/sql/competitor_analysis.sql
-- Idempotent (CREATE TABLE / INDEX IF NOT EXISTS). Mirrored at runtime by
-- cloudflare-worker/src/services/competitorSchema.ts so the Worker self-heals
-- if this migration lands unapplied.

-- One row per saved analysis. Inputs (market/ICP/geo/problem/depth/nudge) are
-- stored as JSON to keep the schema stable as the input surface evolves.
CREATE TABLE IF NOT EXISTS competitor_analyses (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    project_id INTEGER,
    mode TEXT NOT NULL DEFAULT 'custom',      -- startup | custom
    title TEXT,
    inputs_json TEXT NOT NULL DEFAULT '{}',
    status TEXT NOT NULL DEFAULT 'draft',      -- draft | running | complete | error
    edited INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_competitor_analyses_user ON competitor_analyses (user_id, updated_at);

-- Discovered / manual competitors, with per-source relevance sub-scores and
-- distilled details (features / pricing / positioning) as JSON.
CREATE TABLE IF NOT EXISTS competitor_candidates (
    id TEXT PRIMARY KEY,
    analysis_id TEXT NOT NULL REFERENCES competitor_analyses(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    domain TEXT,
    url TEXT,
    category TEXT NOT NULL DEFAULT 'direct',    -- direct | adjacent
    relevance_score REAL NOT NULL DEFAULT 0,
    scores_json TEXT NOT NULL DEFAULT '{}',
    summary TEXT,
    details_json TEXT NOT NULL DEFAULT '{}',
    origin TEXT NOT NULL DEFAULT 'discovered',  -- known | discovered | manual
    position INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_competitor_candidates_analysis ON competitor_candidates (analysis_id, position);

-- Provenance: which public URLs fed each candidate.
CREATE TABLE IF NOT EXISTS competitor_sources (
    id TEXT PRIMARY KEY,
    analysis_id TEXT NOT NULL REFERENCES competitor_analyses(id) ON DELETE CASCADE,
    candidate_id TEXT,
    url TEXT NOT NULL,
    kind TEXT,                                  -- homepage | pricing | features | about | news | careers
    title TEXT,
    status INTEGER,
    fetched_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_competitor_sources_analysis ON competitor_sources (analysis_id);

-- Traction / hiring / funding / content signals surfaced during the crawl.
CREATE TABLE IF NOT EXISTS competitor_signals (
    id TEXT PRIMARY KEY,
    analysis_id TEXT NOT NULL REFERENCES competitor_analyses(id) ON DELETE CASCADE,
    candidate_id TEXT,
    signal_type TEXT NOT NULL,                  -- pricing | hiring | content | web | funding
    label TEXT,
    detail TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_competitor_signals_analysis ON competitor_signals (analysis_id);

-- The generated (and user-editable) structured report.
CREATE TABLE IF NOT EXISTS competitor_analysis_outputs (
    analysis_id TEXT PRIMARY KEY REFERENCES competitor_analyses(id) ON DELETE CASCADE,
    output_json TEXT NOT NULL DEFAULT '{}',
    edited INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Normalized-text cache for the in-house crawl pipeline (keyed by sha256(url)).
CREATE TABLE IF NOT EXISTS competitor_cached_fetches (
    url_hash TEXT PRIMARY KEY,
    url TEXT NOT NULL,
    status INTEGER,
    title TEXT,
    description TEXT,
    text TEXT,
    headings_json TEXT,
    pricing_json TEXT,
    fetched_at TEXT,
    expires_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_competitor_cached_fetches_exp ON competitor_cached_fetches (expires_at);
