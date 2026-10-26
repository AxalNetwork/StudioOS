-- D1231 / #3239: a review case beside each source, never an account/company merge.
-- Reads discover new sources through views, so member submissions need no new writer.
-- Exact source revisions invalidate decisions even when two edits share a timestamp.
-- The internal revision contains source data and is never returned or logged.
CREATE TABLE IF NOT EXISTS kyb_licensed_studios (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  licence_id INTEGER NOT NULL UNIQUE REFERENCES territory_licences(id),
  entity_name TEXT NOT NULL,
  entity_type TEXT,
  jurisdiction TEXT,
  registration_number TEXT,
  registered_address TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS kyb_cases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  studio_code TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('not_started','in_review','needs_info','approved','rejected','expired','dismissed')),
  linked_user_id INTEGER REFERENCES users(id),
  source_revision TEXT NOT NULL,
  owners_disclosed INTEGER NOT NULL DEFAULT 0 CHECK(owners_disclosed IN (0,1)),
  owners_json TEXT,
  directors_json TEXT,
  registry_matches INTEGER CHECK(registry_matches IN (0,1)),
  good_standing INTEGER CHECK(good_standing IN (0,1)),
  unchecked_owner_reason TEXT,
  decision_reason TEXT,
  requested_documents_json TEXT,
  reviewed_by INTEGER REFERENCES users(id),
  reviewed_at TEXT,
  expires_at TEXT,
  version INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_kyb_cases_scope_status ON kyb_cases(studio_code, status);
CREATE INDEX IF NOT EXISTS idx_kyb_cases_linked ON kyb_cases(linked_user_id, status);
CREATE TABLE IF NOT EXISTS kyb_documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  case_uid TEXT NOT NULL REFERENCES kyb_cases(uid),
  kind TEXT NOT NULL CHECK(kind IN ('incorporation','shareholders','registered_address','other')),
  file_key TEXT NOT NULL UNIQUE,
  content_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL CHECK(size_bytes > 0),
  uploaded_by INTEGER NOT NULL REFERENCES users(id),
  deleted_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_kyb_documents_case ON kyb_documents(case_uid, deleted_at);
CREATE TABLE IF NOT EXISTS kyb_case_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  case_uid TEXT NOT NULL REFERENCES kyb_cases(uid),
  action TEXT NOT NULL,
  actor_id INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_kyb_events_case ON kyb_case_events(case_uid, id);

-- The numeric id (source id * 4 + kind) is stable for the Approvals inbox.
-- uid is the public case address. No copied PII or fictitious approval is backfilled.
CREATE VIEW IF NOT EXISTS kyb_business_sources AS
SELECT cp.id * 4 AS id, 'company-' || cp.id AS uid, 'founder_company' AS kind,
  cp.id AS source_id, cp.id AS company_id, NULL AS account_user_id,
  k.started_by_user_id AS submitted_by_user_id,
  COALESCE(NULLIF(k.entity_name,''), cp.company_name) AS entity_name, cp.company_name AS display_name,
  k.entity_type, k.jurisdiction, k.registration_number, k.registered_address,
  NULL AS tax_id_last4, NULL AS signing_authority_name, NULL AS signing_authority_title,
  NULL AS owners_json, NULL AS directors_json, 0 AS owners_disclosed,
  NULL AS high_risk_country, NULL AS sanctions_last_checked_at,
  COALESCE(k.status, 'not_started') AS source_status, k.submitted_at,
  k.reviewed_at AS source_reviewed_at, k.reviewed_by AS source_reviewed_by,
  json_array(k.updated_at, cp.updated_at, k.status, k.entity_name, cp.company_name, k.entity_type, k.jurisdiction, k.registration_number, k.registered_address) AS source_revision, cp.created_at,
  NULL AS licence_ref
FROM company_profiles cp LEFT JOIN company_kyb_records k ON k.company_id = cp.id
UNION ALL
SELECT p.user_id * 4 + 1, 'account-' || p.user_id,
  CASE WHEN u.role = 'investor' THEN 'investing_entity' ELSE 'partner_firm' END,
  p.user_id, NULL, p.user_id, p.user_id, p.entity_name, p.entity_name,
  p.entity_type, p.registered_country, p.registration_number,
  NULLIF(trim(COALESCE(p.registered_address_line1,'') || ' ' || COALESCE(p.registered_address_line2,'') || ' ' || COALESCE(p.registered_city,'') || ' ' || COALESCE(p.registered_state,'') || ' ' || COALESCE(p.registered_postal,'')), ''),
  p.tax_id_last4, p.signing_authority_name, p.signing_authority_title,
  p.ubos_json, p.directors_json, p.ubo_disclosed,
  p.aml_high_risk_jurisdiction, p.sanctions_last_checked_at,
  'in_review', p.created_at, NULL, NULL, json_array(p.updated_at, p.entity_name, p.entity_type, p.registration_number, p.registered_country, p.registered_address_line1, p.registered_address_line2, p.registered_city, p.registered_state, p.registered_postal, p.tax_id_last4, p.signing_authority_name, p.signing_authority_title, p.ubos_json, p.directors_json, p.ubo_disclosed, p.aml_high_risk_jurisdiction, p.sanctions_last_checked_at), p.created_at, NULL
FROM corporate_profiles p JOIN users u ON u.id = p.user_id WHERE NULLIF(trim(p.entity_name),'') IS NOT NULL
UNION ALL
SELECT i.id * 4 + 2, 'import-' || i.id, 'imported_partner', i.id, NULL, NULL, i.user_id,
  i.legal_name, i.legal_name, i.entity_type, i.jurisdiction, NULL, NULL,
  NULL, NULL, NULL, NULL, NULL, 0, NULL, NULL,
  CASE WHEN i.status = 'dismissed' THEN 'dismissed' ELSE 'in_review' END,
  i.created_at, NULL, NULL, json_array(i.created_at,i.legal_name,i.entity_type,i.jurisdiction,i.status), i.created_at, NULL
FROM kyc_partner_imports i
UNION ALL
SELECT s.id * 4 + 3, 'studio-' || s.id, 'licensed_studio', s.id, NULL, NULL, NULL,
  s.entity_name, s.entity_name, s.entity_type, s.jurisdiction, s.registration_number, s.registered_address,
  NULL, NULL, NULL, NULL, NULL, 0, NULL, NULL, 'in_review', s.created_at,
  NULL, NULL, json_array(s.updated_at,s.entity_name,s.entity_type,s.jurisdiction,s.registration_number,s.registered_address), s.created_at, l.licence_ref
FROM kyb_licensed_studios s JOIN territory_licences l ON l.id = s.licence_id;

CREATE VIEW IF NOT EXISTS kyb_businesses AS
SELECT s.*,
  c.studio_code,
  COALESCE(s.account_user_id, c.linked_user_id) AS linked_user_id,
  CASE WHEN c.source_revision = s.source_revision THEN
    CASE WHEN c.status = 'approved' AND julianday(c.expires_at) <= julianday('now') THEN 'expired' ELSE c.status END
    ELSE CASE WHEN s.source_status = 'pending' THEN 'in_review' ELSE s.source_status END END AS status,
  CASE WHEN c.source_revision = s.source_revision THEN c.reviewed_at ELSE s.source_reviewed_at END AS reviewed_at,
  CASE WHEN c.source_revision = s.source_revision THEN c.reviewed_by ELSE s.source_reviewed_by END AS reviewed_by,
  CASE WHEN c.source_revision = s.source_revision THEN c.expires_at ELSE NULL END AS expires_at,
  c.registry_matches, c.good_standing, c.unchecked_owner_reason, c.decision_reason,
  c.requested_documents_json, COALESCE(c.version, 0) AS version,
  CASE WHEN c.source_revision = s.source_revision THEN c.owners_json END AS case_owners_json,
  CASE WHEN c.source_revision = s.source_revision THEN c.directors_json END AS case_directors_json,
  CASE WHEN c.source_revision = s.source_revision AND c.owners_json IS NOT NULL THEN c.owners_disclosed END AS case_owners_disclosed
FROM kyb_business_sources s LEFT JOIN kyb_cases c ON c.uid = s.uid;
