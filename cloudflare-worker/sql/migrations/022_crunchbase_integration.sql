-- Task #3 (2026-05-10) — Crunchbase integration
-- Adds project-level cached Crunchbase snapshot columns + auto-filled
-- enrichment fields populated by /api/crunchbase/projects/:id/apply.
-- Schema mirrored in cloudflare-worker/sql/schema.sql.

ALTER TABLE projects ADD COLUMN crunchbase_uuid TEXT;
ALTER TABLE projects ADD COLUMN crunchbase_data_json TEXT;
ALTER TABLE projects ADD COLUMN crunchbase_synced_at TEXT;

-- Auto-fill columns derived from the Crunchbase snapshot on apply. These
-- are denormalized for fast list/grid rendering (ProjectsPage, MarketIntel)
-- without requiring a JSON.parse of crunchbase_data_json on every row.
ALTER TABLE projects ADD COLUMN founded_year INTEGER;
ALTER TABLE projects ADD COLUMN hq TEXT;
ALTER TABLE projects ADD COLUMN employee_count TEXT;
ALTER TABLE projects ADD COLUMN last_funding_round TEXT;
ALTER TABLE projects ADD COLUMN total_funding REAL;

CREATE INDEX IF NOT EXISTS idx_projects_crunchbase_uuid ON projects(crunchbase_uuid);
