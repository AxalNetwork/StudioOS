-- D1415 (#3697): a company as a legal entity, and slugs per scope.
--
-- `company_profiles` is the member-editable company record (D1136). It gains
-- the legal fields; officers, locations and the company tax ID get their own
-- tables. `entities` (the staff-only fund fabric, D376) and `company_eins`
-- (per project, D579) stay as they are: neither is synced from here.
--
-- Slugs: a company slug is unique globally; a project slug is unique within
-- its company, or among standalone projects (company_id IS NULL). Existing
-- rows keep slug NULL and are addressed by uid (company) or id (project).
-- A retired slug moves to slug_history in the same batch as the rename and
-- stays reserved for its target (owner question C, answer a).
--
-- Additive only. Officers are ceased and locations closed, never deleted.

ALTER TABLE company_profiles ADD COLUMN legal_name TEXT;
ALTER TABLE company_profiles ADD COLUMN legal_form TEXT
  CHECK (legal_form IS NULL OR legal_form IN ('c_corp','s_corp','llc','lp','ltd','plc','gmbh','sas','bv','other'));
ALTER TABLE company_profiles ADD COLUMN jurisdiction TEXT;
ALTER TABLE company_profiles ADD COLUMN registration_number TEXT;
ALTER TABLE company_profiles ADD COLUMN incorporation_date TEXT
  CHECK (incorporation_date IS NULL OR incorporation_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]');
ALTER TABLE company_profiles ADD COLUMN slug TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_company_profiles_slug ON company_profiles(slug) WHERE slug IS NOT NULL;

ALTER TABLE projects ADD COLUMN slug TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_projects_slug_in_company ON projects(company_id, slug)
  WHERE company_id IS NOT NULL AND slug IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_projects_slug_standalone ON projects(slug)
  WHERE company_id IS NULL AND slug IS NOT NULL;

-- Set when a filed incorporation created or filled a company (part 3).
ALTER TABLE incorporations ADD COLUMN company_id INTEGER REFERENCES company_profiles(id);

-- The company's tax ID, sealed with services/columnCipher.ts under the AAD
-- company_tax_ids:tax_id_enc:<company_id>. Only the last four are readable
-- without decryption.
CREATE TABLE IF NOT EXISTS company_tax_ids (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE DEFAULT (lower(hex(randomblob(16)))),
  company_id INTEGER NOT NULL UNIQUE REFERENCES company_profiles(id),
  kind TEXT NOT NULL CHECK (kind IN ('ein','vat','other')),
  tax_id_enc TEXT NOT NULL CHECK (tax_id_enc LIKE 'v1.%'),
  tax_id_last4 TEXT NOT NULL CHECK (length(tax_id_last4) = 4),
  recorded_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS company_officers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  company_id INTEGER NOT NULL REFERENCES company_profiles(id),
  user_id INTEGER REFERENCES users(id),
  name TEXT NOT NULL CHECK (length(trim(name)) > 0),
  office TEXT NOT NULL CHECK (office IN ('director','officer')),
  title TEXT NOT NULL CHECK (length(trim(title)) > 0),
  appointed_on TEXT,
  ceased_on TEXT,
  recorded_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_company_officers_company ON company_officers(company_id, ceased_on);

CREATE TABLE IF NOT EXISTS company_locations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  company_id INTEGER NOT NULL REFERENCES company_profiles(id),
  kind TEXT NOT NULL CHECK (kind IN ('registered','headquarters','office','other')),
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
-- One open registered address per company: the registered address IS this row.
CREATE UNIQUE INDEX IF NOT EXISTS idx_company_locations_one_registered
  ON company_locations(company_id) WHERE kind = 'registered' AND closed_on IS NULL;

-- Retired slugs. scope_company_id: for a project, the company it sat in when
-- the slug was retired (NULL = standalone); for a company, NULL.
CREATE TABLE IF NOT EXISTS slug_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL CHECK (kind IN ('company','project')),
  scope_company_id INTEGER,
  slug TEXT NOT NULL,
  target_id INTEGER NOT NULL,
  retired_by INTEGER REFERENCES users(id),
  retired_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_slug_history_scope
  ON slug_history(kind, ifnull(scope_company_id, 0), slug);
