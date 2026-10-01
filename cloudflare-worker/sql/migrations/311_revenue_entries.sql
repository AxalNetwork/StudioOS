-- 311_revenue_entries.sql — the Spin-Out Lab revenue ledger (D363, wave 8,
-- Session 8 item 4).
--
-- The Revenue canvas draws a per-customer entry ledger: customer, amount,
-- type, date received, verification status and proof, filtered by type and by
-- status, fed by manual entry and a CSV import. Nothing stored it: the page
-- could only show project_metrics snapshots (an MRR per date) and the
-- project's self-reported proof fields. This is the ledger.
--
--   amount_cents        INTEGER  -- > 0; money is integer cents end to end
--   currency            TEXT     -- 'usd' only for now (the Worker refuses others)
--   revenue_type        TEXT     -- recurring | pilot | one_time | deposit
--   received_on         TEXT     -- YYYY-MM-DD, never after today (+1 day)
--   source              TEXT     -- manual | csv (| stripe, reserved: see below)
--   verification        TEXT     -- verified | supported | manual, SET BY THE
--                                   WORKER from the row, never from a request:
--                                   supported = a proof document is attached,
--                                   manual = none; verified is reserved for
--                                   entries a Stripe charge sync writes, and no
--                                   such sync exists yet (the Stripe import
--                                   records MRR and customer counts, not
--                                   charges), so no path writes it today.
--   proof_document_id   INTEGER  -- a document on the same project
--
-- STANDS ALONE: it depends on no other wave-8 migration. IDEMPOTENT: CREATE …
-- IF NOT EXISTS only. The worker's ensureRevenueEntriesSchema() creates the
-- same objects on a cold isolate as a D235 safety net for these declarations.

CREATE TABLE IF NOT EXISTS revenue_entries (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  uid               TEXT NOT NULL UNIQUE,
  project_id        INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  customer          TEXT NOT NULL,
  amount_cents      INTEGER NOT NULL CHECK (amount_cents > 0),
  currency          TEXT NOT NULL DEFAULT 'usd',
  revenue_type      TEXT NOT NULL CHECK (revenue_type IN ('recurring', 'pilot', 'one_time', 'deposit')),
  received_on       TEXT NOT NULL,
  source            TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'csv', 'stripe')),
  source_ref        TEXT,
  verification      TEXT NOT NULL DEFAULT 'manual' CHECK (verification IN ('verified', 'supported', 'manual')),
  proof_document_id INTEGER REFERENCES documents(id),
  notes             TEXT,
  import_batch      TEXT,
  created_by        INTEGER REFERENCES users(id),
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_revenue_entries_project
  ON revenue_entries(project_id, received_on DESC);
