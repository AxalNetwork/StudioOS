-- D7719 (#7719) — the market study of a Research Project: which product and
-- market it studies, for which customer segments, and which decision it
-- serves. Children of `research_projects` (202611092035_research_projects.sql);
-- the routes are `cloudflare-worker/src/routes/research_studies.ts`.
--
-- ONE STUDY PER PROJECT. `research_studies.project_id` is the key and cascades
-- with the project. A project with no row has no study, which the read says
-- (`study: null`); an empty study is never stored.
--
-- NULL MEANS NOT WRITTEN, never ''. Every text column is bounded by a CHECK the
-- way the project tables are; the Worker's exported limits are the same numbers.
--
-- THE ORIGIN IS WRITTEN ONCE. `origin_market_slug`, `origin_market_name`,
-- `origin_tracked_sector` and `origin_filters_json` are set only when a project
-- and its study are created together from Markets (`POST /with-study`) and are
-- never updated. `origin_filters_json` holds the Markets filters as they were
-- (`q`, `country`, `fresh`, `src`); its `country` is the COMPANY LOCATION
-- filter, never the study's customer geography. `origin_tracked_sector` is the
-- Worker's own market-to-sector mapping at that moment; NULL with a slug means
-- the market had no tracked sector ('none').
--
-- THE VENTURE LINK IS OPTIONAL (owner answer A): at most one `projects` row,
-- SET NULL when the venture goes. A segment's Validate link names a
-- `customer_segments` row of that venture, SET NULL when the row goes.
--
-- A SEGMENT IS ARCHIVED, NEVER DELETED, so a later reference keeps its target.
-- One live segment per study may be the beachhead (partial unique index).
-- Statistical unit and industry scheme are checked against exported lists in
-- the Worker, not by a CHECK, so a list can grow without a table rebuild (the
-- same rule #7716 states for the observation store).
--
-- No transaction statements: D1 rejects them (scripts/check-sql-migrations.mjs).

CREATE TABLE IF NOT EXISTS research_studies (
  project_id             INTEGER PRIMARY KEY REFERENCES research_projects(id) ON DELETE CASCADE,
  owner_user_id          INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  product                TEXT CHECK (product IS NULL OR length(trim(product)) BETWEEN 1 AND 200),
  product_boundary       TEXT CHECK (product_boundary IS NULL OR length(trim(product_boundary)) BETWEEN 1 AND 1000),
  business_model         TEXT CHECK (business_model IS NULL OR length(trim(business_model)) BETWEEN 1 AND 500),
  decision               TEXT CHECK (decision IS NULL OR length(trim(decision)) BETWEEN 1 AND 1000),
  horizon_months         INTEGER CHECK (horizon_months IS NULL OR horizon_months BETWEEN 1 AND 120),
  origin_market_slug     TEXT CHECK (origin_market_slug IS NULL OR length(origin_market_slug) BETWEEN 1 AND 64),
  origin_market_name     TEXT CHECK (origin_market_name IS NULL OR length(trim(origin_market_name)) BETWEEN 1 AND 160),
  origin_tracked_sector  TEXT CHECK (origin_tracked_sector IS NULL OR length(trim(origin_tracked_sector)) BETWEEN 1 AND 120),
  origin_filters_json    TEXT CHECK (origin_filters_json IS NULL OR (json_valid(origin_filters_json) AND length(origin_filters_json) <= 2000)),
  venture_project_id     INTEGER REFERENCES projects(id) ON DELETE SET NULL,
  request_id             TEXT CHECK (request_id IS NULL OR length(request_id) BETWEEN 8 AND 64),
  version                INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_by             INTEGER NOT NULL REFERENCES users(id),
  created_at             TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at             TEXT NOT NULL DEFAULT (datetime('now')),
  -- The origin is all or nothing: a slug and its name, or neither.
  CHECK ((origin_market_slug IS NULL) = (origin_market_name IS NULL)),
  CHECK (origin_market_slug IS NOT NULL OR (origin_tracked_sector IS NULL AND origin_filters_json IS NULL))
);

-- A repeated `/with-study` form returns the first project: one study per
-- member and request id.
CREATE UNIQUE INDEX IF NOT EXISTS idx_research_studies_request
  ON research_studies(owner_user_id, request_id) WHERE request_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_research_studies_venture
  ON research_studies(venture_project_id) WHERE venture_project_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS research_study_segments (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  uid                  TEXT NOT NULL UNIQUE CHECK (length(uid) BETWEEN 8 AND 64),
  project_id           INTEGER NOT NULL REFERENCES research_studies(project_id) ON DELETE CASCADE,
  name                 TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 120),
  buyer                TEXT CHECK (buyer IS NULL OR length(trim(buyer)) BETWEEN 1 AND 200),
  end_user             TEXT CHECK (end_user IS NULL OR length(trim(end_user)) BETWEEN 1 AND 200),
  budget_holder        TEXT CHECK (budget_holder IS NULL OR length(trim(budget_holder)) BETWEEN 1 AND 200),
  purchasing_unit      TEXT CHECK (purchasing_unit IS NULL OR length(trim(purchasing_unit)) BETWEEN 1 AND 200),
  statistical_unit     TEXT CHECK (statistical_unit IS NULL OR length(statistical_unit) BETWEEN 1 AND 40),
  industry_scheme      TEXT CHECK (industry_scheme IS NULL OR length(industry_scheme) BETWEEN 1 AND 40),
  industry_codes_json  TEXT CHECK (industry_codes_json IS NULL OR (json_valid(industry_codes_json) AND json_type(industry_codes_json) = 'array' AND length(industry_codes_json) <= 1000)),
  size_band            TEXT CHECK (size_band IS NULL OR length(trim(size_band)) BETWEEN 1 AND 120),
  customer_countries_json TEXT CHECK (customer_countries_json IS NULL OR (json_valid(customer_countries_json) AND json_type(customer_countries_json) = 'array' AND length(customer_countries_json) <= 1000)),
  exclusions           TEXT CHECK (exclusions IS NULL OR length(trim(exclusions)) BETWEEN 1 AND 1000),
  beachhead            INTEGER NOT NULL DEFAULT 0 CHECK (beachhead IN (0, 1)),
  validate_segment_id  INTEGER REFERENCES customer_segments(id) ON DELETE SET NULL,
  sample_note          TEXT CHECK (sample_note IS NULL OR length(trim(sample_note)) BETWEEN 1 AND 1000),
  sample_limits        TEXT CHECK (sample_limits IS NULL OR length(trim(sample_limits)) BETWEEN 1 AND 1000),
  position             INTEGER NOT NULL CHECK (position >= 1),
  version              INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  archived_at          TEXT,
  created_by           INTEGER NOT NULL REFERENCES users(id),
  created_at           TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at           TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_research_study_segments_project
  ON research_study_segments(project_id, archived_at, position);

-- One beachhead among a study's live segments.
CREATE UNIQUE INDEX IF NOT EXISTS idx_research_study_segments_beachhead
  ON research_study_segments(project_id) WHERE beachhead = 1 AND archived_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_research_study_segments_validate
  ON research_study_segments(validate_segment_id) WHERE validate_segment_id IS NOT NULL;
