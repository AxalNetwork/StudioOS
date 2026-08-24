-- Use of Funds planning metadata (Spin-Out Lab Week-4 tool rebuild).
-- Migration 158. Applied automatically by scripts/migrate-d1.mjs (numeric
-- order, ledgered in schema_migrations). Additive; seeds NO rows.
--
-- `use_of_funds_meta` stores a small founder-editable JSON object next to the
-- canonical `use_of_funds` allocation:
--   { alert_threshold_months, deck_synced_at, axal_exported_at,
--     milestones: [{ id, name, bucket, cost }] }
-- It backs the Use of Funds page's runway alert threshold, milestone→capital
-- cost mapping (Roadmap milestones don't carry costs; the costs live here),
-- and the Pitch Deck / Axal export sync timestamps. Written ONLY through the
-- owner-editable project update route, which validates the JSON shape and
-- caps its size. The route also ensures this column at runtime
-- (ensureProjectUofMetaColumn) so a cold D1 isolate / dev SQLite works before
-- this migration applies.
--
-- Bare ALTER (non-idempotent) is acceptable: genuinely-new column and the
-- forward-only runner applies each file exactly once.

ALTER TABLE projects ADD COLUMN use_of_funds_meta TEXT;
