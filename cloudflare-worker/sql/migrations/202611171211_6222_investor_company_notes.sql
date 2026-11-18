-- D6222 (#6222): an investor's private notes on a portfolio company.
--
--   investor_company_notes  one row per note, keyed by its author and the
--                           company (`projects.id`). Only the author reads,
--                           edits or deletes it; the company and every other
--                           investor never see it (routes/portfolio_notes.ts).
--                           `source` is NULL for a note typed by hand, or
--                           'what_changed' for one saved from Eadwyn's "What
--                           changed since the last report" card, with the two
--                           reports it compared (`from_report_uid`, the
--                           earlier, and `to_report_uid`), both or neither.
--                           `created_at` is when it was written and
--                           `updated_at` when it was last edited (equal until
--                           an edit).
--
-- The shape is deal_notes' (migration 600: uid, author, a 1–10,000 character
-- body, created and updated times) keyed by company instead of by deal, with
-- no firm column: deal_notes are shared with the author's firm, these are
-- never shared (D6222 says why deal_notes is not reused).
--
-- Grep first (D689 D-t): no `investor_company_notes` table exists in
-- schema_baseline.sql or an earlier migration. `account_note_saves` (639) is
-- the admin's save record for `users.admin_notes`, not a notes store.
--
-- Additive: CREATE ... IF NOT EXISTS only. No backfill: no note is inferred.

CREATE TABLE IF NOT EXISTS investor_company_notes (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  uid              TEXT NOT NULL UNIQUE DEFAULT (lower(hex(randomblob(16)))),
  author_user_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id       INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  body             TEXT NOT NULL CHECK (length(trim(body)) BETWEEN 1 AND 10000),
  source           TEXT CHECK (source IS NULL OR source = 'what_changed'),
  from_report_uid  TEXT CHECK (from_report_uid IS NULL OR length(from_report_uid) BETWEEN 1 AND 64),
  to_report_uid    TEXT CHECK (to_report_uid IS NULL OR length(to_report_uid) BETWEEN 1 AND 64),
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK ((from_report_uid IS NULL) = (to_report_uid IS NULL)),
  CHECK (from_report_uid IS NULL OR source IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_investor_company_notes_author ON investor_company_notes (author_user_id, project_id, id DESC);
