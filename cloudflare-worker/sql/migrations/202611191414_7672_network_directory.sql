-- D7672 (#7672): source-backed external directory; no account, HR, book or tie backfill.
-- Directory identity is separate from workspace membership and relationship evidence.
CREATE TABLE IF NOT EXISTS network_directory_sources (
  uid TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  url TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS network_directory_import_runs (
  uid TEXT PRIMARY KEY,
  planner_version TEXT NOT NULL,
  input_hash TEXT NOT NULL,
  input_count INTEGER NOT NULL CHECK (input_count >= 0),
  accepted_count INTEGER NOT NULL CHECK (accepted_count >= 0),
  review_count INTEGER NOT NULL CHECK (review_count >= 0),
  skipped_count INTEGER NOT NULL CHECK (skipped_count >= 0),
  status TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('planned', 'complete')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT,
  CHECK (input_count = accepted_count + review_count + skipped_count)
);

-- An entry may represent either a person or an organization, never both.
-- Imports never set either verified link. Linking a company does not confer membership.
CREATE TABLE IF NOT EXISTS network_directory_entries (
  uid TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('person', 'organization')),
  source_uid TEXT NOT NULL REFERENCES network_directory_sources(uid),
  source_external_id TEXT NOT NULL,
  display_name TEXT NOT NULL CHECK (length(trim(display_name)) BETWEEN 1 AND 300),
  first_name TEXT,
  last_name TEXT,
  profile_url TEXT,
  website TEXT,
  geography TEXT,
  roles_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(roles_json)),
  source_categories_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(source_categories_json)),
  sectors_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(sectors_json)),
  stages_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(stages_json)),
  currently_investing INTEGER CHECK (currently_investing IS NULL OR currently_investing IN (0, 1)),
  previous_investments_raw TEXT,
  verification_status TEXT NOT NULL DEFAULT 'unverified_source_claim' CHECK (verification_status IN ('unverified_source_claim', 'reviewed', 'verified', 'withdrawn')),
  publication_status TEXT NOT NULL DEFAULT 'staged' CHECK (publication_status IN ('staged', 'published', 'suppressed', 'archived')),
  linked_user_id INTEGER REFERENCES users(id),
  linked_company_id INTEGER REFERENCES company_profiles(id),
  link_verified_by INTEGER REFERENCES users(id),
  link_verified_at TEXT,
  observed_at TEXT NOT NULL,
  UNIQUE (uid, kind),
  UNIQUE (source_uid, source_external_id),
  CHECK ((linked_user_id IS NULL OR kind = 'person') AND (linked_company_id IS NULL OR kind = 'organization')),
  CHECK ((linked_user_id IS NULL AND linked_company_id IS NULL AND link_verified_by IS NULL AND link_verified_at IS NULL)
    OR ((linked_user_id IS NOT NULL OR linked_company_id IS NOT NULL) AND link_verified_by IS NOT NULL AND link_verified_at IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_network_directory_user_link ON network_directory_entries(linked_user_id) WHERE linked_user_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_network_directory_company_link ON network_directory_entries(linked_company_id) WHERE linked_company_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_network_directory_kind_name ON network_directory_entries(kind, display_name);

-- Immutable observations. Reruns preserve prior snapshots and explicit review dispositions.
CREATE TABLE IF NOT EXISTS network_directory_source_records (
  uid TEXT PRIMARY KEY,
  source_uid TEXT NOT NULL REFERENCES network_directory_sources(uid),
  external_record_id TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  decision_hash TEXT NOT NULL,
  entry_uid TEXT,
  entry_kind TEXT,
  disposition TEXT NOT NULL CHECK (disposition IN ('accept', 'review', 'skip')),
  reasons_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(reasons_json)),
  claims_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(claims_json)),
  observed_at TEXT NOT NULL,
  FOREIGN KEY (entry_uid, entry_kind) REFERENCES network_directory_entries(uid, kind),
  CHECK ((entry_uid IS NULL AND entry_kind IS NULL) OR (entry_uid IS NOT NULL AND entry_kind IS NOT NULL)),
  CHECK (disposition = 'accept' OR entry_uid IS NULL),
  UNIQUE (uid, entry_uid, entry_kind),
  UNIQUE (source_uid, external_record_id, content_hash, decision_hash)
);
CREATE INDEX IF NOT EXISTS idx_network_directory_record_identity ON network_directory_source_records(source_uid, external_record_id, observed_at);

-- This is operator-only material, including original email/phone cells and malformed input.
-- No member/public route may select this table. A future operator route must enforce its role.
CREATE TABLE IF NOT EXISTS network_directory_private_sources (
  source_record_uid TEXT PRIMARY KEY REFERENCES network_directory_source_records(uid),
  access_scope TEXT NOT NULL DEFAULT 'operator_only' CHECK (access_scope = 'operator_only'),
  raw_json TEXT NOT NULL CHECK (json_valid(raw_json))
);

CREATE TABLE IF NOT EXISTS network_directory_import_rows (
  run_uid TEXT NOT NULL REFERENCES network_directory_import_runs(uid),
  row_key TEXT NOT NULL,
  source_record_uid TEXT NOT NULL REFERENCES network_directory_source_records(uid),
  observed_at TEXT NOT NULL,
  PRIMARY KEY (run_uid, row_key)
);

-- The supplied list associates a person with an organization; it does not prove employment.
CREATE TABLE IF NOT EXISTS network_directory_affiliations (
  uid TEXT PRIMARY KEY,
  person_uid TEXT NOT NULL,
  person_kind TEXT NOT NULL DEFAULT 'person' CHECK (person_kind = 'person'),
  organization_uid TEXT NOT NULL,
  organization_kind TEXT NOT NULL DEFAULT 'organization' CHECK (organization_kind = 'organization'),
  source_record_uid TEXT NOT NULL REFERENCES network_directory_source_records(uid),
  relation_kind TEXT NOT NULL DEFAULT 'source_association' CHECK (relation_kind IN ('source_association', 'employment', 'advisory', 'board', 'other')),
  title TEXT,
  start_date TEXT,
  end_date TEXT,
  is_current INTEGER CHECK (is_current IS NULL OR is_current IN (0, 1)),
  verification_status TEXT NOT NULL DEFAULT 'unverified_source_claim' CHECK (verification_status IN ('unverified_source_claim', 'reviewed', 'verified', 'withdrawn')),
  observed_at TEXT NOT NULL,
  FOREIGN KEY (person_uid, person_kind) REFERENCES network_directory_entries(uid, kind),
  FOREIGN KEY (organization_uid, organization_kind) REFERENCES network_directory_entries(uid, kind),
  FOREIGN KEY (source_record_uid, person_uid, person_kind) REFERENCES network_directory_source_records(uid, entry_uid, entry_kind),
  CHECK (start_date IS NULL OR end_date IS NULL OR start_date <= end_date)
);
CREATE INDEX IF NOT EXISTS idx_network_directory_affiliation_org ON network_directory_affiliations(organization_uid, person_uid);

CREATE TABLE IF NOT EXISTS network_directory_reviews (
  uid TEXT PRIMARY KEY,
  source_record_uid TEXT NOT NULL REFERENCES network_directory_source_records(uid),
  candidate_record_uid TEXT REFERENCES network_directory_source_records(uid),
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'kept_separate', 'resolved', 'dismissed')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Future adapters may link an owned book row after review. No importer writes this table.
CREATE TABLE IF NOT EXISTS network_directory_book_links (
  book_kind TEXT NOT NULL CHECK (book_kind IN ('network_connections', 'contacts', 'partner_book_contacts')),
  book_record_id TEXT NOT NULL,
  owner_user_id INTEGER NOT NULL REFERENCES users(id),
  person_uid TEXT NOT NULL,
  person_kind TEXT NOT NULL DEFAULT 'person' CHECK (person_kind = 'person'),
  linked_by_user_id INTEGER NOT NULL REFERENCES users(id),
  linked_at TEXT NOT NULL,
  FOREIGN KEY (person_uid, person_kind) REFERENCES network_directory_entries(uid, kind),
  PRIMARY KEY (book_kind, book_record_id, owner_user_id)
);

-- Research catalogs are separate from company workspaces. This bridge is empty.
-- A firm linked to a managed vehicle is not identified as that vehicle.
CREATE TABLE IF NOT EXISTS network_directory_research_links (
  uid TEXT PRIMARY KEY,
  organization_uid TEXT NOT NULL,
  organization_kind TEXT NOT NULL DEFAULT 'organization' CHECK (organization_kind = 'organization'),
  company_directory_uid TEXT REFERENCES research_company_directory(uid),
  fund_directory_uid TEXT REFERENCES research_fund_directory(uid),
  target_kind TEXT NOT NULL CHECK (target_kind IN ('company', 'fund_manager', 'managed_fund_vehicle')),
  source_record_uid TEXT NOT NULL,
  reviewed_by_user_id INTEGER NOT NULL REFERENCES users(id),
  reviewed_at TEXT NOT NULL,
  evidence_url TEXT NOT NULL CHECK (length(trim(evidence_url)) > 0),
  status TEXT NOT NULL DEFAULT 'reviewed' CHECK (status IN ('reviewed', 'withdrawn')),
  FOREIGN KEY (organization_uid, organization_kind) REFERENCES network_directory_entries(uid, kind),
  FOREIGN KEY (source_record_uid, organization_uid, organization_kind) REFERENCES network_directory_source_records(uid, entry_uid, entry_kind),
  CHECK ((company_directory_uid IS NOT NULL) + (fund_directory_uid IS NOT NULL) = 1),
  CHECK ((target_kind = 'company' AND company_directory_uid IS NOT NULL) OR (target_kind IN ('fund_manager', 'managed_fund_vehicle') AND fund_directory_uid IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_network_directory_research_company ON network_directory_research_links(company_directory_uid) WHERE company_directory_uid IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_network_directory_research_fund ON network_directory_research_links(fund_directory_uid) WHERE fund_directory_uid IS NOT NULL;
