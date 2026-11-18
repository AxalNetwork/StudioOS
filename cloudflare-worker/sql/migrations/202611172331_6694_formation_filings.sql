-- D6694 (#6694, plan key E9 of #6680): a formation case's filings, their
-- timeline, and the case's documents.
--
-- One hand-typed date used to stand for "filed": the day the filing was
-- submitted, with no registration number. A case now holds filings, each with
-- its own state, evidence and attempt, and registration writes the registry's
-- facts to the company. One service writes these tables
-- (cloudflare-worker/src/services/formationFilings.ts): each change is a
-- conditional UPDATE plus an event.
--
-- New tables only. Nothing on incorporations, formation_cases or the company
-- tables changes shape here.

CREATE TABLE IF NOT EXISTS formation_filings (
  id                           INTEGER PRIMARY KEY AUTOINCREMENT,
  uid                          TEXT NOT NULL UNIQUE,
  case_id                      INTEGER NOT NULL,
  kind                         TEXT NOT NULL CHECK (kind IN ('name_reservation', 'incorporation', 'tax_registration', 'vat', 'payroll',
                                 'beneficial_owner_register', 'foreign_investment_notice', 'other')),
  authority_name               TEXT,
  submitted_by_party           TEXT CHECK (submitted_by_party IS NULL OR submitted_by_party IN ('founder', 'hq', 'partner', 'counsel')),
  reference                    TEXT,
  -- The day the filing was submitted. It is never the registry's date.
  submitted_on                 TEXT CHECK (submitted_on IS NULL OR submitted_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  state                        TEXT NOT NULL DEFAULT 'prepared'
                                 CHECK (state IN ('prepared', 'submitted', 'queried', 'accepted', 'rejected', 'withdrawn')),
  -- The registry's date on an accepted or rejected filing.
  decided_on                   TEXT CHECK (decided_on IS NULL OR decided_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  rejection_reason             TEXT,
  registration_number          TEXT,
  certificate_document_id      INTEGER,
  pack_document_id             INTEGER,
  pack_sha256                  TEXT CHECK (pack_sha256 IS NULL OR (length(pack_sha256) = 64 AND pack_sha256 NOT GLOB '*[^0-9a-f]*')),
  founder_approved_at          TEXT,
  -- The pack hash the founder approved. Submission needs it equal to pack_sha256.
  founder_approved_sha256      TEXT,
  founder_approval_request_id  INTEGER,
  attempt                      INTEGER NOT NULL DEFAULT 1 CHECK (attempt >= 1),
  supersedes_filing_id         INTEGER,
  -- 1 only on a legacy_v1 correction: a registration recorded after the fact, with no pack approval to show.
  recorded_after_the_fact      INTEGER NOT NULL DEFAULT 0 CHECK (recorded_after_the_fact IN (0, 1)),
  -- Each change adds one; an event's to_revision names the change it records.
  revision                     INTEGER NOT NULL DEFAULT 0,
  created_by                   INTEGER,
  created_at                   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at                   TEXT NOT NULL DEFAULT (datetime('now')),
  -- An incorporation filing past prepared carries the founder's approval of its own pack.
  CHECK (kind <> 'incorporation' OR state IN ('prepared', 'withdrawn') OR recorded_after_the_fact = 1
         OR (pack_sha256 IS NOT NULL AND founder_approved_at IS NOT NULL AND founder_approved_sha256 = pack_sha256)),
  -- An accepted incorporation filing carries the registry's number, date and certificate.
  CHECK (kind <> 'incorporation' OR state <> 'accepted'
         OR (registration_number IS NOT NULL AND decided_on IS NOT NULL AND certificate_document_id IS NOT NULL)),
  CHECK (state <> 'rejected' OR decided_on IS NOT NULL),
  UNIQUE (case_id, kind, attempt)
);
-- One live filing of a kind per case: a new attempt waits for the last to be rejected or withdrawn.
CREATE UNIQUE INDEX IF NOT EXISTS idx_formation_filings_live
  ON formation_filings(case_id, kind) WHERE state NOT IN ('rejected', 'withdrawn');
CREATE INDEX IF NOT EXISTS idx_formation_filings_case ON formation_filings(case_id, id);

-- A correction is a new row: a filing is never deleted.
CREATE TRIGGER IF NOT EXISTS trg_formation_filings_no_delete
BEFORE DELETE ON formation_filings
BEGIN
  SELECT RAISE(ABORT, 'formation_filings rows are kept');
END;

-- Append-only: each state change of a filing, with what the person entered.
CREATE TABLE IF NOT EXISTS formation_filing_events (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  filing_id             INTEGER NOT NULL,
  from_state            TEXT,
  to_state              TEXT NOT NULL,
  -- The filing's revision after this change; two events never claim the same one.
  to_revision           INTEGER NOT NULL,
  occurred_on           TEXT CHECK (occurred_on IS NULL OR occurred_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  recorded_by           INTEGER,
  evidence_document_id  INTEGER,
  detail_json           TEXT,
  created_at            TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_formation_filing_events_filing ON formation_filing_events(filing_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_formation_filing_events_revision ON formation_filing_events(filing_id, to_revision);

CREATE TRIGGER IF NOT EXISTS trg_formation_filing_events_no_update
BEFORE UPDATE ON formation_filing_events
BEGIN
  SELECT RAISE(ABORT, 'formation_filing_events rows are append-only');
END;

CREATE TRIGGER IF NOT EXISTS trg_formation_filing_events_no_delete
BEFORE DELETE ON formation_filing_events
BEGIN
  SELECT RAISE(ABORT, 'formation_filing_events rows are append-only');
END;

-- The documents a case holds, by class, and who may see each one.
CREATE TABLE IF NOT EXISTS formation_case_documents (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  uid           TEXT NOT NULL UNIQUE,
  case_id       INTEGER NOT NULL,
  filing_id     INTEGER,
  document_id   INTEGER NOT NULL,
  class         TEXT NOT NULL CHECK (class IN ('filing_pack', 'certificate', 'registry_receipt', 'registry_query', 'rejection_notice', 'evidence', 'other')),
  visible_to    TEXT NOT NULL DEFAULT 'hq_only' CHECK (visible_to IN ('all', 'hq_partner', 'hq_only')),
  added_by      INTEGER,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (case_id, document_id, class)
);
CREATE INDEX IF NOT EXISTS idx_formation_case_documents_case ON formation_case_documents(case_id, class);
