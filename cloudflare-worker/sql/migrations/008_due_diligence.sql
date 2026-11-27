-- Task #3 — Due Diligence module schema.
--
-- Eight tables modelling the full DD lifecycle: case → sections → findings,
-- with external-source ingestion, attachments, expert reviewers, generated
-- reports, and an immutable audit trail.
--
-- PII handling: every free-text/identifier column that may contain PII
-- (subject_email, subject_legal_name, finding_subject_name, evidence
-- snippets) is stored as a column-cipher v1 ciphertext via
-- services/columnCipher.ts. The corresponding `*_idx` columns hold a
-- deterministic HMAC for equality lookup.
--
-- Idempotency: every CREATE uses IF NOT EXISTS. Re-applying this file
-- is a no-op (no ALTER TABLE statements). Apply via:
--   wrangler d1 execute studioos-db --remote --file=cloudflare-worker/sql/migrations/008_due_diligence.sql

CREATE TABLE IF NOT EXISTS dd_cases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  subject_type TEXT NOT NULL CHECK(subject_type IN ('project','founder','mentor','investor','partner')),
  subject_id INTEGER NOT NULL,
  subject_label TEXT NOT NULL,
  subject_email_enc TEXT,
  subject_email_idx TEXT,
  subject_legal_name_enc TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','in_review','completed','archived')),
  risk_score REAL,
  risk_band TEXT CHECK(risk_band IN ('green','yellow','amber','red')),
  owner_user_id INTEGER NOT NULL REFERENCES users(id),
  notes_enc TEXT,
  external_scan_completed_at TIMESTAMP,
  report_generated_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_dd_cases_owner ON dd_cases(owner_user_id, status);
CREATE INDEX IF NOT EXISTS idx_dd_cases_subject ON dd_cases(subject_type, subject_id);
CREATE INDEX IF NOT EXISTS idx_dd_cases_status ON dd_cases(status, risk_band);

CREATE TABLE IF NOT EXISTS dd_sections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  case_id INTEGER NOT NULL REFERENCES dd_cases(id) ON DELETE CASCADE,
  section_key TEXT NOT NULL,
  title TEXT NOT NULL,
  weight REAL NOT NULL DEFAULT 1.0,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','assigned','in_review','completed','blocked')),
  assignee_user_id INTEGER REFERENCES users(id),
  verdict TEXT CHECK(verdict IN ('pass','warn','fail','n_a')),
  reviewer_notes_enc TEXT,
  reviewer_signed_nda_at TIMESTAMP,
  completed_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(case_id, section_key)
);
CREATE INDEX IF NOT EXISTS idx_dd_sections_case ON dd_sections(case_id, status);
CREATE INDEX IF NOT EXISTS idx_dd_sections_assignee ON dd_sections(assignee_user_id, status);

CREATE TABLE IF NOT EXISTS dd_findings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  case_id INTEGER NOT NULL REFERENCES dd_cases(id) ON DELETE CASCADE,
  section_id INTEGER REFERENCES dd_sections(id) ON DELETE SET NULL,
  source_id INTEGER REFERENCES dd_external_sources(id) ON DELETE SET NULL,
  source_kind TEXT NOT NULL,
  severity TEXT NOT NULL CHECK(severity IN ('info','low','medium','high','critical')),
  title TEXT NOT NULL,
  detail_enc TEXT,
  subject_name_enc TEXT,
  evidence_url TEXT,
  evidence_excerpt_enc TEXT,
  resolved_at TIMESTAMP,
  resolved_by_user_id INTEGER REFERENCES users(id),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_dd_findings_case ON dd_findings(case_id, severity);
CREATE INDEX IF NOT EXISTS idx_dd_findings_section ON dd_findings(section_id);

CREATE TABLE IF NOT EXISTS dd_external_sources (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  case_id INTEGER NOT NULL REFERENCES dd_cases(id) ON DELETE CASCADE,
  connector TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','running','ok','error','disabled')),
  query_hash TEXT,
  raw_response_enc TEXT,
  records_count INTEGER DEFAULT 0,
  findings_emitted INTEGER DEFAULT 0,
  error_message TEXT,
  started_at TIMESTAMP,
  completed_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_dd_sources_case ON dd_external_sources(case_id, connector);

CREATE TABLE IF NOT EXISTS dd_attachments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  case_id INTEGER NOT NULL REFERENCES dd_cases(id) ON DELETE CASCADE,
  section_id INTEGER REFERENCES dd_sections(id) ON DELETE SET NULL,
  file_key TEXT NOT NULL,
  filename TEXT NOT NULL,
  mime_type TEXT,
  size_bytes INTEGER,
  uploaded_by_user_id INTEGER REFERENCES users(id),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_dd_attachments_case ON dd_attachments(case_id);

CREATE TABLE IF NOT EXISTS dd_reviewers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  case_id INTEGER NOT NULL REFERENCES dd_cases(id) ON DELETE CASCADE,
  section_id INTEGER NOT NULL REFERENCES dd_sections(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id),
  role TEXT NOT NULL DEFAULT 'reviewer' CHECK(role IN ('reviewer','lead','observer')),
  invited_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  responded_at TIMESTAMP,
  magic_link_jti TEXT,
  nda_signed_at TIMESTAMP,
  UNIQUE(section_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_dd_reviewers_user ON dd_reviewers(user_id);

CREATE TABLE IF NOT EXISTS dd_reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  case_id INTEGER NOT NULL REFERENCES dd_cases(id) ON DELETE CASCADE,
  storage_key TEXT,
  format TEXT NOT NULL CHECK(format IN ('pdf','html')),
  -- 1 when the bytes at storage_key are encrypted via cryptoBox.encryptBytes
  -- (the on-disk content type is then 'application/octet-stream' and the
  -- *real* content type is recorded in `inner_content_type`). Download
  -- route looks at this column to decide whether to decrypt before
  -- streaming to the browser.
  encrypted INTEGER NOT NULL DEFAULT 1,
  inner_content_type TEXT,
  risk_score_at_generation REAL,
  risk_band_at_generation TEXT,
  generated_by_user_id INTEGER NOT NULL REFERENCES users(id),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_dd_reports_case ON dd_reports(case_id, created_at DESC);

CREATE TABLE IF NOT EXISTS dd_audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  case_id INTEGER NOT NULL REFERENCES dd_cases(id) ON DELETE CASCADE,
  actor_user_id INTEGER REFERENCES users(id),
  actor_email_hash TEXT,
  action TEXT NOT NULL,
  target_type TEXT,
  target_id INTEGER,
  details_enc TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_dd_audit_case ON dd_audit_log(case_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_dd_audit_actor ON dd_audit_log(actor_user_id, created_at DESC);
