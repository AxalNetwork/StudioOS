-- D7826 (#7826): Research organizations, their roles, the catalogue records they own and the sourced relationships
-- between them. Read and written only by services/researchOrganizations.ts; the reads go through the company served
-- rows (D7819) and SERVED_FUNDS (D597). Nothing here holds a Network directory id, a person, a fund statement or a
-- vehicle fact, and nothing here is filled from a manager-name clue. The tables start empty: the first records are #7827.

CREATE TABLE IF NOT EXISTS research_organizations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE CHECK (length(uid) BETWEEN 1 AND 64),
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 300),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  created_by_user_id INTEGER
);

-- A role from the closed set, each with its source and the date the source states it.
CREATE TABLE IF NOT EXISTS research_organization_roles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  organization_id INTEGER NOT NULL REFERENCES research_organizations(id),
  role TEXT NOT NULL CHECK (role IN ('operating_company', 'registered_investment_adviser', 'fund_manager', 'fund_vehicle',
    'accelerator', 'venture_capital', 'corporate_venture', 'growth_private_equity', 'family_office', 'lender',
    'corporate_group', 'other')),
  source_name TEXT NOT NULL CHECK (length(trim(source_name)) BETWEEN 1 AND 300),
  source_url TEXT CHECK (source_url IS NULL OR source_url LIKE 'https://%'),
  stated_on TEXT NOT NULL CHECK (stated_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  recorded_at TEXT NOT NULL DEFAULT (datetime('now')),
  recorded_by_user_id INTEGER,
  UNIQUE (organization_id, role)
);
CREATE INDEX IF NOT EXISTS idx_research_organization_roles_org ON research_organization_roles(organization_id);

-- A catalogue record the organization owns. A record belongs to at most one organization: one link that is not
-- withdrawn per record. `record_type` is company or fund (a fund row's own kind is #7744's `record_kind`, not here).
CREATE TABLE IF NOT EXISTS research_organization_record_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  organization_id INTEGER NOT NULL REFERENCES research_organizations(id),
  record_type TEXT NOT NULL CHECK (record_type IN ('company', 'fund')),
  record_uid TEXT NOT NULL CHECK (length(record_uid) BETWEEN 1 AND 64),
  origin TEXT NOT NULL CHECK (origin IN ('source_record', 'reviewed')),
  state TEXT NOT NULL DEFAULT 'proposed' CHECK (state IN ('proposed', 'confirmed', 'withdrawn')),
  source_name TEXT CHECK (source_name IS NULL OR length(trim(source_name)) BETWEEN 1 AND 300),
  source_url TEXT CHECK (source_url IS NULL OR source_url LIKE 'https://%'),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  confirmed_at TEXT,
  confirmed_by_user_id INTEGER,
  CHECK ((state = 'confirmed') = (confirmed_at IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_research_organization_record_links_one_owner
  ON research_organization_record_links(record_type, record_uid) WHERE state <> 'withdrawn';
CREATE INDEX IF NOT EXISTS idx_research_organization_record_links_org ON research_organization_record_links(organization_id);

-- A sourced relationship between two organizations. Both ends are organizations, so no person is ever at either end.
-- A relationship needs its source link, where in the source it is stated and the date the source states it.
-- 'invested_in' alone may carry the investor's role and its own amount with its currency, and may point at a
-- company_funding_rounds row for the round's facts; it never copies a round total.
CREATE TABLE IF NOT EXISTS research_organization_relationships (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  subject_organization_id INTEGER NOT NULL REFERENCES research_organizations(id),
  relation TEXT NOT NULL CHECK (relation IN ('manages', 'advises', 'vehicle_of', 'member_of_group', 'invested_in')),
  object_organization_id INTEGER NOT NULL REFERENCES research_organizations(id),
  source_url TEXT NOT NULL CHECK (source_url LIKE 'https://%' AND length(source_url) <= 2000),
  source_locator TEXT NOT NULL CHECK (length(trim(source_locator)) BETWEEN 1 AND 500),
  stated_on TEXT NOT NULL CHECK (stated_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  state TEXT NOT NULL DEFAULT 'recorded' CHECK (state IN ('recorded', 'withdrawn')),
  investor_role TEXT CHECK (investor_role IS NULL OR investor_role IN ('lead', 'co_lead', 'participant')),
  amount_minor INTEGER CHECK (amount_minor IS NULL OR amount_minor > 0),
  amount_currency TEXT CHECK (amount_currency IS NULL OR amount_currency GLOB '[A-Z][A-Z][A-Z]'),
  funding_round_id INTEGER REFERENCES company_funding_rounds(funding_round_id),
  recorded_at TEXT NOT NULL DEFAULT (datetime('now')),
  recorded_by_user_id INTEGER,
  CHECK (subject_organization_id <> object_organization_id),
  CHECK ((amount_minor IS NULL) = (amount_currency IS NULL)),
  CHECK (relation = 'invested_in' OR (investor_role IS NULL AND amount_minor IS NULL AND funding_round_id IS NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_research_organization_relationships_statement
  ON research_organization_relationships(subject_organization_id, relation, object_organization_id, source_url, source_locator);
CREATE INDEX IF NOT EXISTS idx_research_organization_relationships_object ON research_organization_relationships(object_organization_id);
