-- Migration 141 — Watchlist + Decision Journal contract reconciliation (Task #14).
--
-- Investor audit ⑦. The React SPA (frontend/src/lib/api.js +
-- WatchlistJournalPage.jsx) and the dev FastAPI backend already agree on a rich
-- contract, but the production Worker (routes/watchlist.ts + routes/journal.ts)
-- persisted a much narrower schema and silently dropped/rejected writes:
--   * watchlist create required a numeric project_id and rejected external
--     prospects (project_id NOT NULL); no external_name/url/sector/stage/
--     source/tags columns; status enum missing passed_on/archived.
--   * journal decision enum missing 'defer'; outcome stored as win|loss|pending
--     instead of outcome_status pending|hit|miss|partial|inconclusive; no
--     watchlist_item_id/key_risks/expected_multiple/expected_timeline_months/
--     tags/outcome_actual_multiple/decided_at.
--
-- This migration brings the Worker's D1 schema up to the SPA/dev contract so
-- writes round-trip losslessly, and adds `reminded_at` on watchlist_items to
-- drive the next_check_at follow-up reminder sweep (services/watchlistReminders.ts).
--
-- Forward-only, NOT idempotent (D1/SQLite lack ADD COLUMN IF NOT EXISTS and the
-- rebuild DROP/RENAME cannot be conditionally gated). The predeploy runner
-- (scripts/migrate-d1.mjs) applies it exactly once via the schema_migrations
-- ledger and aborts loudly on error. Mirrored into sql/t13_t14_t15.sql (the
-- canonical DDL bundle for these tables; they are not in schema.sql).
--
-- No PRAGMA foreign_keys (references are documentation-only, house style).

-- ---------------------------------------------------------------------------
-- 1. watchlist_items — rebuild to make project_id NULLable (external
--    prospects) and add external_name/url/sector/stage/source/tags_json +
--    reminded_at. INSERT..SELECT preserves ids so decision_journal_entries'
--    new watchlist_item_id column keeps pointing at the right rows. Backfill
--    legacy status 'passed' -> 'passed_on'. NOTE: no SQL BEGIN/COMMIT — D1
--    rejects transaction statements ("use state.storage.transaction()...");
--    the wrangler `d1 execute --file` batch is applied atomically by D1.
-- ---------------------------------------------------------------------------
DROP TABLE IF EXISTS watchlist_items_new;
CREATE TABLE watchlist_items_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  owner_user_id INTEGER NOT NULL,
  project_id INTEGER,                       -- NULL for external prospects
  external_name TEXT,
  external_url TEXT,
  sector TEXT,
  stage TEXT,
  thesis TEXT,
  conviction TEXT,                          -- low | medium | high
  source TEXT,                              -- referral | inbound | cold | conf | ...
  tags_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'watching',  -- watching | converted | passed_on | archived
  next_check_at TEXT,
  reminded_at TEXT,                         -- last follow-up reminder fired (Task #14)
  passed_reason TEXT,
  passed_at TEXT,
  converted_deal_id INTEGER,
  converted_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (owner_user_id, project_id)
);
INSERT INTO watchlist_items_new
  (id, uid, owner_user_id, project_id, thesis, conviction, status,
   next_check_at, passed_reason, passed_at, converted_deal_id, converted_at,
   created_at, updated_at)
SELECT
  id, uid, owner_user_id, project_id, thesis, conviction,
  CASE WHEN status = 'passed' THEN 'passed_on' ELSE status END,
  next_check_at, passed_reason, passed_at, converted_deal_id, converted_at,
  created_at, updated_at
FROM watchlist_items;
DROP TABLE watchlist_items;
ALTER TABLE watchlist_items_new RENAME TO watchlist_items;
CREATE INDEX IF NOT EXISTS idx_watchlist_owner ON watchlist_items(owner_user_id, status);
CREATE INDEX IF NOT EXISTS idx_watchlist_project ON watchlist_items(project_id);
-- External items are unique by name within an owner (matches dev entity).
CREATE UNIQUE INDEX IF NOT EXISTS uq_watchlist_owner_external
  ON watchlist_items(owner_user_id, external_name) WHERE project_id IS NULL;

-- ---------------------------------------------------------------------------
-- 2. decision_journal_entries — add the richer contract columns. Bare ALTERs
--    (forward-only, non-idempotent — mirrors 140_investor_profile_unify.sql).
--    The legacy `outcome` (win|loss|pending) column is deliberately KEPT (not
--    dropped) so the original values survive the forward-only migration.
-- ---------------------------------------------------------------------------
ALTER TABLE decision_journal_entries ADD COLUMN watchlist_item_id INTEGER;
ALTER TABLE decision_journal_entries ADD COLUMN key_risks TEXT;
ALTER TABLE decision_journal_entries ADD COLUMN expected_multiple REAL;
ALTER TABLE decision_journal_entries ADD COLUMN expected_timeline_months INTEGER;
ALTER TABLE decision_journal_entries ADD COLUMN tags_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE decision_journal_entries ADD COLUMN outcome_status TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE decision_journal_entries ADD COLUMN outcome_actual_multiple REAL;
ALTER TABLE decision_journal_entries ADD COLUMN decided_at TEXT;
CREATE INDEX IF NOT EXISTS idx_journal_watchlist ON decision_journal_entries(watchlist_item_id);
CREATE INDEX IF NOT EXISTS idx_journal_outcome_status ON decision_journal_entries(outcome_status);

-- ---------------------------------------------------------------------------
-- 3. Backfill decision_journal_entries to the new contract.
-- ---------------------------------------------------------------------------
-- decided_at defaults to the row's creation time for legacy rows.
UPDATE decision_journal_entries SET decided_at = created_at WHERE decided_at IS NULL;
-- Map legacy outcome (win|loss|pending) onto outcome_status.
UPDATE decision_journal_entries SET outcome_status = 'hit'  WHERE outcome = 'win';
UPDATE decision_journal_entries SET outcome_status = 'miss' WHERE outcome = 'loss';
-- Retired decision values collapse onto 'defer' (the SPA/dev enum).
UPDATE decision_journal_entries SET decision = 'defer' WHERE decision IN ('follow', 'other');
-- conviction was free-text (low|medium|high) in the Worker; SPA/dev use 1..5.
UPDATE decision_journal_entries SET conviction = CASE lower(conviction)
    WHEN 'low' THEN '2' WHEN 'medium' THEN '3' WHEN 'high' THEN '4'
    ELSE conviction END
  WHERE conviction IS NOT NULL;
