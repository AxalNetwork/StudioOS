-- Task #32 — Contacts "promote" creates/links a REAL downstream record.
--
-- Before this, POST /api/contacts/:uid/promote only stamped promoted_to +
-- status='qualified' (a flag with no object behind it). Now promoting a
-- CUSTOMER contact creates/links a discovery_interviews row, and promoting an
-- INVESTOR contact creates/links a raise_prospects row. The link is stored on
-- contacts.promoted_ref_id and interpreted via promoted_to
-- ('discovery' -> discovery_interviews.id, 'raise' -> raise_prospects.id).
--
-- Bare ALTER: SQLite has no `ADD COLUMN IF NOT EXISTS`. The forward-only
-- migration runner applies this once and records it in the ledger; the lazy
-- guard in routes/contacts.ts ensureSchema() PRAGMA-checks and adds the same
-- column at runtime for isolates that boot before this migration lands.

ALTER TABLE contacts ADD COLUMN promoted_ref_id INTEGER;

-- Per-project investor raise pipeline. One row per promoted investor prospect,
-- linked back to the originating contact. Founder-owned via project_id (the
-- Contacts hub already scopes writes by project ownership).
CREATE TABLE IF NOT EXISTS raise_prospects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT UNIQUE NOT NULL,
  project_id INTEGER NOT NULL,
  contact_id INTEGER,
  name TEXT,
  email TEXT,
  firm TEXT,
  stage TEXT NOT NULL DEFAULT 'to_contact',
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_raise_prospects_project ON raise_prospects(project_id);
CREATE INDEX IF NOT EXISTS idx_raise_prospects_contact ON raise_prospects(contact_id);
