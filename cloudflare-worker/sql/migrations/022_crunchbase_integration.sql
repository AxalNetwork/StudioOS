-- Task #3 (2026-05-10) — Crunchbase integration
-- Adds project-level cached Crunchbase snapshot columns + index.
-- Schema mirrored in cloudflare-worker/sql/schema.sql.

ALTER TABLE projects ADD COLUMN crunchbase_uuid TEXT;
ALTER TABLE projects ADD COLUMN crunchbase_data_json TEXT;
ALTER TABLE projects ADD COLUMN crunchbase_synced_at TEXT;

CREATE INDEX IF NOT EXISTS idx_projects_crunchbase_uuid ON projects(crunchbase_uuid);
