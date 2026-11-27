-- Task #6 (AT-1) — Market Intelligence extractors, storage & endpoints.
--
-- Four storage tables back six advisor-derived MI extractors
-- (sentiment, talc_position, thesis_embedding, demand_supply,
-- fit_match, sector_heat). Reads always go to `market_intel_aggregates`
-- (fast); raw per-answer rows live in `market_intel_signals` and the
-- vectorized embedding BLOBs in `market_intel_embeddings`. All
-- free-text excerpts are paraphrased and persisted in
-- `market_intel_snippets` with origin redacted (k-anonymity ≥ 5).
--
-- Per-user opt-out is `users.mi_contribution_optout` (0 = contribute,
-- 1 = excluded; honored within 24h by the nightly reconciliation).
--
-- IDEMPOTENCY: every CREATE is `IF NOT EXISTS`. The trailing
-- ALTER TABLE is NOT idempotent — `services/market_intel/extractor_schema.ts`
-- (`ensureExtractorSchema`) wraps it in try/catch so the column is
-- self-healed on first request when this file aborts on re-run.

-- ---- Per-answer signal observations -------------------------------------
-- Append-only. One row per (user_id, advisor_answer_id, extractor) so
-- re-running an extractor on the same input is idempotent via the
-- UNIQUE index. `payload_json` carries the extractor's structured
-- output (e.g. {valence, energy, topic_tag} for sentiment).
CREATE TABLE IF NOT EXISTS market_intel_signals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  extractor TEXT NOT NULL,                  -- 'sentiment' | 'talc' | 'demand_supply' | 'fit_match' | 'sector_heat'
  user_id INTEGER NOT NULL,
  persona TEXT NOT NULL,                    -- 'founder' | 'investor' | 'mentor' | 'partner'
  advisor_answer_id INTEGER,                -- nullable — nightly reconciliation rows have no source row
  question_id TEXT,
  sector TEXT,                              -- canonical sector slug (NULL when global)
  geo TEXT,                                 -- ISO country / 'global'
  period_key TEXT NOT NULL,                 -- 'YYYY-WW' (week) for sentiment / 'YYYY-MM' for slow signals
  -- Structured extractor output (JSON). Keys vary by extractor; see
  -- the per-extractor TS file for the contract.
  payload_json TEXT NOT NULL,
  -- Stable hash of (user_id, question_id, raw answer normalisation) so
  -- re-runs on the same content are no-ops.
  content_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(extractor, user_id, advisor_answer_id, content_hash)
);
CREATE INDEX IF NOT EXISTS idx_mi_signals_extractor_period
  ON market_intel_signals(extractor, period_key);
CREATE INDEX IF NOT EXISTS idx_mi_signals_user
  ON market_intel_signals(user_id);
CREATE INDEX IF NOT EXISTS idx_mi_signals_sector_period
  ON market_intel_signals(sector, period_key);

-- ---- Aggregated cells (k-anonymised) ------------------------------------
-- The single read surface. Nightly reconciliation rebuilds rows here
-- by grouping signals on (extractor, dimension_key, period_key) and
-- suppresses cells where n < 5. Read endpoints filter `n >= 5` again
-- defensively so a partial mid-rebuild row never leaks identifiers.
CREATE TABLE IF NOT EXISTS market_intel_aggregates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  extractor TEXT NOT NULL,
  -- Bucket key, e.g. 'sector:fintech', 'talc:investor:scaling',
  -- 'demand_supply:fintech:operators', 'sector_heat:fintech',
  -- 'fit:investor:42' (PII-free; founder ids hashed prior to writes).
  dimension_key TEXT NOT NULL,
  period_key TEXT NOT NULL,
  n INTEGER NOT NULL,                       -- distinct contributing users
  -- Numeric cell value (mean valence, % share, composite score …).
  -- For multi-value cells (e.g. heatmap row) stash JSON in payload_json.
  value REAL,
  payload_json TEXT,
  computed_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(extractor, dimension_key, period_key)
);
CREATE INDEX IF NOT EXISTS idx_mi_agg_extractor_period
  ON market_intel_aggregates(extractor, period_key);
CREATE INDEX IF NOT EXISTS idx_mi_agg_dimension
  ON market_intel_aggregates(dimension_key);

-- ---- Per-user vector embeddings (thesis / discovery text) ---------------
-- Used by `thesis_embedding` + `fit_match` extractors. We keep the
-- raw 768-dim Float32 vector as a BLOB so we don't depend on
-- Vectorize for the cosine matrix (Vectorize is reserved for the
-- 768-dim `axal-search` index per Task #5).
CREATE TABLE IF NOT EXISTS market_intel_embeddings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  persona TEXT NOT NULL,                    -- 'founder' | 'investor'
  -- 'thesis' | 'discovery' | 'needs' | 'offerings'
  kind TEXT NOT NULL,
  source_question_id TEXT,
  vector BLOB NOT NULL,                     -- Float32Array of length 768
  norm REAL NOT NULL,                       -- pre-computed L2 norm for cosine
  content_hash TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, kind)
);
CREATE INDEX IF NOT EXISTS idx_mi_emb_persona_kind
  ON market_intel_embeddings(persona, kind);

-- ---- Paraphrased free-text snippets (origin-redacted) -------------------
-- Anywhere a free-text excerpt is shown in MI surfaces, the snippet
-- is routed through `aiRouter.run('paraphrase', …)` and persisted
-- here. Reads JOIN by aggregate_id so a paraphrased excerpt never
-- escapes the k≥5 gate. `origin_redacted` is always 1; the column
-- is kept for forward-compat in case future flows need raw text.
CREATE TABLE IF NOT EXISTS market_intel_snippets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  extractor TEXT NOT NULL,
  dimension_key TEXT NOT NULL,
  period_key TEXT NOT NULL,
  paraphrase TEXT NOT NULL,
  origin_redacted INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_mi_snippets_dim
  ON market_intel_snippets(extractor, dimension_key, period_key);

-- ---- Per-user opt-out (default: contribute) ------------------------------
-- Honored within 24h by the nightly reconciliation: opted-out users'
-- signals are excluded from the aggregate rebuild AND their
-- previously-contributed signal rows are deleted (CASCADE-equivalent
-- via the nightly purge). The column is bootstrapped at request time
-- by `extractor_schema.ts` so the file aborting here on re-run does
-- not break dev D1.
ALTER TABLE users ADD COLUMN mi_contribution_optout INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_users_mi_optout
  ON users(mi_contribution_optout) WHERE mi_contribution_optout = 1;
