-- Task #16 (AK) — Investor Matching: thesis extension.
--
-- Adds anti-thesis + value-weights fields to investor_profiles so matching
-- can hard-exclude on anti-thesis and score values_alignment.
--
-- Caveat: D1 and SQLite lack ALTER TABLE ADD COLUMN IF NOT EXISTS.
-- The in-code lazy-bootstrap (investor_signals.ts ensureSchema) creates
-- these columns on first run if this migration is missing; re-running
-- this migration errors harmlessly on duplicate-column.

ALTER TABLE investor_profiles ADD COLUMN anti_thesis_sectors_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE investor_profiles ADD COLUMN anti_thesis_stages_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE investor_profiles ADD COLUMN value_weights_json TEXT NOT NULL DEFAULT '{}';
