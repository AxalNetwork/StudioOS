-- D417 — F2's obligation store: the filings calendar of a fund-fabric entity
-- (Funds · Fabric canvas, F2 "Entity dossier", "the filings calendar is the
-- working half").
--
-- Until now filing deadlines were recorded only for founder companies
-- (`compliance_events`, each row against a project). A GP entity, a
-- management company or a fund vehicle had nowhere to hold "Delaware
-- franchise tax, due 1 June", so HQ · Funds could not raise one (D375, D376).
--
-- One row per obligation occurrence on one entity. A row is never deleted:
-- it is filed (with the date and who recorded it) or waived (with a reason),
-- and filing a recurring obligation opens its next occurrence as a new row,
-- linked from the filed one by `next_uid`, so the calendar keeps its history.
--
-- No tenant column: which branch an entity belongs to is the database that
-- holds it (D245, D376). Additive and standalone: one new table and its
-- index, no ALTER of an existing table, no transaction.

CREATE TABLE IF NOT EXISTS entity_obligations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  entity_id INTEGER NOT NULL REFERENCES entities(id),
  kind TEXT NOT NULL CHECK (kind IN (
    'franchise_tax', 'registered_agent', 'annual_report', 'board_meeting', 'regulatory_filing', 'other'
  )),
  title TEXT NOT NULL CHECK (length(trim(title)) > 0),
  cadence TEXT NOT NULL CHECK (cadence IN ('annual', 'quarterly', 'monthly', 'one_time', 'event')),
  -- 'YYYY-MM-DD'. NULL only for an event-driven obligation with nothing open
  -- yet (an 83(b) window watches for a grant that has not happened).
  due_date TEXT CHECK (due_date IS NULL OR due_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'filed', 'waived')),
  resolved_on TEXT,
  resolved_by INTEGER REFERENCES users(id),
  resolution_note TEXT,
  -- The occurrence opened when this one was filed, for a recurring cadence.
  next_uid TEXT,
  -- 'pack' rows were seeded from a jurisdiction pack (`pack_key` names the
  -- pack and rule); 'manual' rows were entered by an admin.
  source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('pack', 'manual')),
  pack_key TEXT,
  note TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  -- A resolved row has its date; an open one has none.
  CHECK ((status = 'open') = (resolved_on IS NULL)),
  -- The same obligation is not entered twice for the same date, which is
  -- also what makes seeding a pack idempotent.
  UNIQUE (entity_id, kind, title, due_date)
);

CREATE INDEX IF NOT EXISTS idx_entity_obligations_due
  ON entity_obligations(entity_id, status, due_date);
