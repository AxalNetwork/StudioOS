-- #2392 local rebuild prototype; migration and decision numbers pending S1.
-- Not in sql/migrations: the production migration runner cannot apply this file.
-- Move to the assigned migration path and update its regression test before a PR.

-- Current case creation uses project/founder/advisor/investor/partner.
-- mentor remains accepted at storage for lossless historical reads only.
-- D1 supplies one implicit transaction; no BEGIN/COMMIT or table rename.
-- Recreate the parent under its own name so deferred external references
-- (ic_decisions.dd_case_id) resolve when its original IDs are restored.
-- DROP TABLE cascades into all nine DD child tables even with FK checks
-- deferred: snapshot them before the drop, then restore every column,
-- including migration 339's sign-off and encrypted payloads, without decoding.
-- Existing child definitions/indexes stay intact. Restore the parent's three
-- explicit indexes and its deleted-highest-ID AUTOINCREMENT history too.

PRAGMA defer_foreign_keys = TRUE;

CREATE TABLE dd_subject_sequence_snapshot AS SELECT seq FROM sqlite_sequence WHERE name='dd_cases';

CREATE TABLE dd_cases_subject_snapshot AS SELECT * FROM dd_cases;

CREATE TABLE dd_sections_subject_snapshot AS SELECT * FROM dd_sections;

CREATE TABLE dd_external_sources_subject_snapshot AS SELECT * FROM dd_external_sources;

CREATE TABLE dd_findings_subject_snapshot AS SELECT * FROM dd_findings;

CREATE TABLE dd_attachments_subject_snapshot AS SELECT * FROM dd_attachments;

CREATE TABLE dd_reviewers_subject_snapshot AS SELECT * FROM dd_reviewers;

CREATE TABLE dd_reports_subject_snapshot AS SELECT * FROM dd_reports;

CREATE TABLE dd_audit_log_subject_snapshot AS SELECT * FROM dd_audit_log;

CREATE TABLE dd_checklist_items_subject_snapshot AS SELECT * FROM dd_checklist_items;

CREATE TABLE dd_requests_subject_snapshot AS SELECT * FROM dd_requests;

DROP TABLE dd_cases;

CREATE TABLE dd_cases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  subject_type TEXT NOT NULL CHECK(subject_type IN ('project','founder','mentor','advisor','investor','partner')),
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
, template_depth TEXT NOT NULL DEFAULT 'standard');

DELETE FROM dd_requests;

DELETE FROM dd_checklist_items;

DELETE FROM dd_audit_log;

DELETE FROM dd_reports;

DELETE FROM dd_reviewers;

DELETE FROM dd_attachments;

DELETE FROM dd_findings;

DELETE FROM dd_external_sources;

DELETE FROM dd_sections;

INSERT INTO dd_cases (id, uid, subject_type, subject_id, subject_label, subject_email_enc, subject_email_idx, subject_legal_name_enc, status, risk_score, risk_band, owner_user_id, notes_enc, external_scan_completed_at, report_generated_at, created_at, updated_at, template_depth) SELECT id, uid, subject_type, subject_id, subject_label, subject_email_enc, subject_email_idx, subject_legal_name_enc, status, risk_score, risk_band, owner_user_id, notes_enc, external_scan_completed_at, report_generated_at, created_at, updated_at, template_depth FROM dd_cases_subject_snapshot;

INSERT INTO dd_sections SELECT * FROM dd_sections_subject_snapshot;

INSERT INTO dd_external_sources SELECT * FROM dd_external_sources_subject_snapshot;

INSERT INTO dd_findings SELECT * FROM dd_findings_subject_snapshot;

INSERT INTO dd_attachments SELECT * FROM dd_attachments_subject_snapshot;

INSERT INTO dd_reviewers SELECT * FROM dd_reviewers_subject_snapshot;

INSERT INTO dd_reports SELECT * FROM dd_reports_subject_snapshot;

INSERT INTO dd_audit_log SELECT * FROM dd_audit_log_subject_snapshot;

INSERT INTO dd_checklist_items SELECT * FROM dd_checklist_items_subject_snapshot;

INSERT INTO dd_requests SELECT * FROM dd_requests_subject_snapshot;

UPDATE sqlite_sequence SET seq = MAX(seq, COALESCE((SELECT MAX(seq) FROM dd_subject_sequence_snapshot), seq)) WHERE name='dd_cases';

INSERT INTO sqlite_sequence (name,seq) SELECT 'dd_cases',seq FROM dd_subject_sequence_snapshot WHERE NOT EXISTS (SELECT 1 FROM sqlite_sequence WHERE name='dd_cases');

CREATE INDEX idx_dd_cases_owner ON dd_cases(owner_user_id, status);

CREATE INDEX idx_dd_cases_status ON dd_cases(status, risk_band);

CREATE INDEX idx_dd_cases_subject ON dd_cases(subject_type, subject_id);

DROP TABLE dd_cases_subject_snapshot;

DROP TABLE dd_sections_subject_snapshot;

DROP TABLE dd_external_sources_subject_snapshot;

DROP TABLE dd_findings_subject_snapshot;

DROP TABLE dd_attachments_subject_snapshot;

DROP TABLE dd_reviewers_subject_snapshot;

DROP TABLE dd_reports_subject_snapshot;

DROP TABLE dd_audit_log_subject_snapshot;

DROP TABLE dd_checklist_items_subject_snapshot;

DROP TABLE dd_requests_subject_snapshot;

DROP TABLE dd_subject_sequence_snapshot;
