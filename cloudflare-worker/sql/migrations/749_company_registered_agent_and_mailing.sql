-- 749 — the company's registered agent and mailing address (D1593, #3861;
-- the Portfolio canvas's PF8a and PF8b legal facts sheet and the PF2 Legal
-- card, #3696). Number given on #3861 by S1, 2026-10-31.
--
-- company_profiles.registered_agent_name: the agent's name, as Incorporate
-- already collects it with every order (incorporations.registered_agent_name).
-- Nothing is backfilled here; filing copies it onto the company (#3855).
--
-- company_locations.kind gains 'mailing', with at most one open mailing
-- address per company, as there is one open registered address.
--
-- SQLite cannot widen a CHECK in place, so company_locations is rebuilt with
-- the same columns, defaults and keys, and every row is copied with its id.
-- No row changes and none is added. The registered index is created again on
-- the new table, beside the new mailing one. company_locations has no foreign
-- key into it and no trigger on it (grep: only 685 creates it, and
-- routes/company_legal.ts is its only reader).

ALTER TABLE company_profiles ADD COLUMN registered_agent_name TEXT;

CREATE TABLE company_locations_v749 (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  company_id INTEGER NOT NULL REFERENCES company_profiles(id),
  kind TEXT NOT NULL CHECK (kind IN ('registered','headquarters','office','mailing','other')),
  label TEXT,
  line1 TEXT,
  line2 TEXT,
  city TEXT,
  region TEXT,
  postal_code TEXT,
  country TEXT NOT NULL CHECK (length(country) = 2),
  closed_on TEXT,
  created_by INTEGER NOT NULL REFERENCES users(id),
  updated_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO company_locations_v749 (id, uid, company_id, kind, label, line1, line2, city, region, postal_code, country,
  closed_on, created_by, updated_by, created_at, updated_at)
SELECT id, uid, company_id, kind, label, line1, line2, city, region, postal_code, country,
  closed_on, created_by, updated_by, created_at, updated_at
FROM company_locations;

DROP TABLE company_locations;
ALTER TABLE company_locations_v749 RENAME TO company_locations;

-- One open registered address per company: the registered address IS this row.
CREATE UNIQUE INDEX IF NOT EXISTS idx_company_locations_one_registered
  ON company_locations(company_id) WHERE kind = 'registered' AND closed_on IS NULL;
-- And one open mailing address per company.
CREATE UNIQUE INDEX IF NOT EXISTS idx_company_locations_one_mailing
  ON company_locations(company_id) WHERE kind = 'mailing' AND closed_on IS NULL;
