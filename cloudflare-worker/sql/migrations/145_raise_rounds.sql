-- 145 — Raise Pipeline v1: active fundraising rounds, investor updates, and a
-- check-size amount on prospects.
--
-- raise_rounds: one 'active' round per project (partial unique index — same
-- pattern as uq_stages_one_active in 020) summarised in the pipeline header
-- (target, raised = SUM(amount) of committed prospects, close date).
-- raise_investor_updates: founder-authored updates posted from the pipeline;
-- each is also logged to linked contacts' timelines via contact_replies.
--
-- The worker lazily bootstraps all of this in routes/contacts.ts ensureSchema
-- (tables via IF NOT EXISTS; the prospect `amount` column via a PRAGMA-guarded
-- try/catch ALTER — the documented reference pattern for ALTERs, see
-- GOTCHAS.md "Migrations & schema"). This file is the canonical record. The
-- bare ALTER below makes the file non-idempotent: on a DB where the runtime
-- bootstrap already added the column (local/preview started before migrating),
-- apply order matters — run the migration first, or rely on the bootstrap.
-- raise_prospects itself is created by 128_contact_promotion.sql, so the ALTER
-- is safe on any DB migrated in order.

CREATE TABLE IF NOT EXISTS raise_rounds (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT UNIQUE NOT NULL,
  project_id INTEGER NOT NULL,
  name TEXT,
  target_amount REAL,
  close_date TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_raise_rounds_project ON raise_rounds(project_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_raise_rounds_active ON raise_rounds(project_id) WHERE status = 'active';

CREATE TABLE IF NOT EXISTS raise_investor_updates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT UNIQUE NOT NULL,
  project_id INTEGER NOT NULL,
  round_id INTEGER,
  subject TEXT NOT NULL,
  body TEXT,
  recipients_count INTEGER NOT NULL DEFAULT 0,
  created_by INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_raise_updates_project ON raise_investor_updates(project_id);

ALTER TABLE raise_prospects ADD COLUMN amount REAL;
