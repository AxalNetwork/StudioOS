-- D6692 (#6692, P1 of the global incorporation plan #6680): the formation
-- partner registry. Which partner firm may do what, where, under which
-- licence and which data terms, at which price, and who at the firm acts.
--
--   formation_partners             one row per partner firm (`partners.id`)
--                                  that HQ registers for formation work: its
--                                  state, what verifying it checked, and its
--                                  data agreement.
--   formation_partner_credentials  a licence in one country: type, number,
--                                  regulator, valid until, evidence, who
--                                  checked it and on which day.
--   formation_partner_coverage     a form in a country and one service the
--                                  partner does for it; switched on or off.
--   formation_partner_prices       the price of one coverage row for a
--                                  period: what the founder pays and what
--                                  the partner costs, in integer minor units
--                                  of one currency.
--   formation_partner_members      a user who acts for the partner firm, with
--                                  who granted it and when it was revoked.
--
-- The rules that need more than a column (coverage switched on only with an
-- unexpired credential for its country; verify refused without a signed data
-- agreement; a suspension switching coverage off in the same batch) are the
-- route's and the service's: routes/admin_formation_partners.ts and
-- services/formationPartners.ts, tested in
-- cloudflare-worker/test/formation_partners_6692.test.ts.
--
-- Grep first: no table named formation_partner* exists in schema_baseline.sql
-- or any migration. Additive only: five new tables and their indexes, each
-- `IF NOT EXISTS`.

CREATE TABLE IF NOT EXISTS formation_partners (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE DEFAULT (lower(hex(randomblob(16)))),
  partner_id INTEGER NOT NULL UNIQUE REFERENCES partners(id),
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'verified', 'suspended', 'ended')),
  deal_id INTEGER REFERENCES partner_deals(id),
  verified_by INTEGER REFERENCES users(id),
  verified_at TEXT,
  what_was_checked TEXT,
  next_review_on TEXT,
  -- What the partner is under data protection law for founders' data.
  data_role TEXT CHECK (data_role IS NULL OR data_role IN ('processor', 'controller', 'joint_controller')),
  dpa_document_id INTEGER REFERENCES documents(id),
  dpa_signed_on TEXT,
  transfer_mechanism TEXT,
  retention_terms TEXT,
  deletion_contact TEXT,
  -- A JSON array of places the partner may not hold or process data in.
  restricted_places_json TEXT NOT NULL DEFAULT '[]',
  status_reason TEXT,
  status_changed_by INTEGER REFERENCES users(id),
  status_changed_at TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_formation_partners_status ON formation_partners(status);

CREATE TABLE IF NOT EXISTS formation_partner_credentials (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE DEFAULT (lower(hex(randomblob(16)))),
  formation_partner_id INTEGER NOT NULL REFERENCES formation_partners(id),
  -- ISO 3166-1 alpha-2, upper case.
  country TEXT NOT NULL,
  licence_type TEXT NOT NULL,
  licence_number TEXT NOT NULL,
  regulator TEXT NOT NULL,
  -- A date (YYYY-MM-DD): the licence holds through this day.
  valid_until TEXT NOT NULL,
  evidence_document_id INTEGER REFERENCES documents(id),
  checked_by INTEGER REFERENCES users(id),
  checked_on TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_formation_partner_credentials_partner
  ON formation_partner_credentials(formation_partner_id, country);

CREATE TABLE IF NOT EXISTS formation_partner_coverage (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE DEFAULT (lower(hex(randomblob(16)))),
  formation_partner_id INTEGER NOT NULL REFERENCES formation_partners(id),
  country TEXT NOT NULL,
  form_key TEXT NOT NULL,
  service TEXT NOT NULL CHECK (service IN (
    'formation', 'registered_agent', 'registered_office', 'company_secretary',
    'resident_director', 'contact_person', 'identity_verification',
    'structure_memo', 'tax_registration', 'bank_introduction')),
  target_hours INTEGER CHECK (target_hours IS NULL OR target_hours > 0),
  priority INTEGER NOT NULL DEFAULT 100,
  is_on INTEGER NOT NULL DEFAULT 0 CHECK (is_on IN (0, 1)),
  switched_by INTEGER REFERENCES users(id),
  switched_at TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (formation_partner_id, country, form_key, service)
);
CREATE INDEX IF NOT EXISTS idx_formation_partner_coverage_on
  ON formation_partner_coverage(country, form_key, service, is_on);

CREATE TABLE IF NOT EXISTS formation_partner_prices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE DEFAULT (lower(hex(randomblob(16)))),
  coverage_id INTEGER NOT NULL REFERENCES formation_partner_coverage(id),
  -- Integer minor units of `currency` (cents for USD), never a float.
  founder_price_minor INTEGER NOT NULL CHECK (founder_price_minor >= 0),
  -- What the partner costs Axal. The Super Admin's: never returned to anyone else.
  cost_minor INTEGER CHECK (cost_minor IS NULL OR cost_minor >= 0),
  currency TEXT NOT NULL,
  cadence TEXT NOT NULL CHECK (cadence IN ('one_time', 'monthly', 'annual')),
  effective_from TEXT NOT NULL,
  effective_to TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_formation_partner_prices_coverage
  ON formation_partner_prices(coverage_id, effective_from);

CREATE TABLE IF NOT EXISTS formation_partner_members (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE DEFAULT (lower(hex(randomblob(16)))),
  formation_partner_id INTEGER NOT NULL REFERENCES formation_partners(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  role TEXT NOT NULL CHECK (role IN ('lead', 'staff')),
  granted_by INTEGER REFERENCES users(id),
  granted_at TEXT NOT NULL DEFAULT (datetime('now')),
  revoked_at TEXT,
  revoked_by INTEGER REFERENCES users(id)
);
-- A user holds at most one live membership of a partner.
CREATE UNIQUE INDEX IF NOT EXISTS idx_formation_partner_members_live
  ON formation_partner_members(formation_partner_id, user_id) WHERE revoked_at IS NULL;
