-- 476 — D712 (#1777): fund report drafts and the admin review queue.
--
-- A scheduled job, or an Admin, builds a DRAFT from the fund records. A draft
-- is a record admins read; only an issue makes it an LP's document. Four kinds
-- (decision 1):
--
--   entity_cash_monthly   one per Axal entity per calendar month   admins
--   lp_capital_statement  one per LP of an administered fund      that LP
--   lp_quarterly_report   one per administered fund per quarter    its LPs
--   mgmt_fee_statement    one per #1774 statement                  LP or admins
--
-- Four states (decision 2): draft, prepared, issued, superseded. An Admin
-- prepares; a Super Admin who is not the preparer issues. A rebuild writes a
-- new revision and supersedes the old one; a correction is a new draft that
-- names the issued one it corrects (`corrects_draft_id`). Issued rows never
-- change.
--
-- WHAT THE REVIEWER SAW IS WHAT IS ISSUED (decision 3). Each draft freezes its
-- figures as JSON with the SHA-256 digest of that stored string, and nothing
-- may rewrite either.
--
-- The seals follow 312's (`312_fund_call_ledger.sql`): triggers that RAISE, so
-- an UPDATE or DELETE that breaks a rule aborts its whole D1 batch.
--
-- No BEGIN/COMMIT. Every column was grepped in schema_baseline.sql and every
-- migration first; neither table exists anywhere else.

CREATE TABLE IF NOT EXISTS fund_report_drafts (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  uid                 TEXT NOT NULL UNIQUE,
  kind                TEXT NOT NULL CHECK (kind IN ('entity_cash_monthly', 'lp_capital_statement', 'lp_quarterly_report', 'mgmt_fee_statement')),
  audience            TEXT NOT NULL CHECK (audience IN ('admins', 'lp', 'fund_lps')),
  subject_key         TEXT NOT NULL CHECK (subject_key GLOB 'entity:?*' OR subject_key GLOB 'fund:[1-9]*'
                                           OR subject_key GLOB 'lp:[1-9]*' OR subject_key GLOB 'fee:?*'),
  entity_key          TEXT CHECK (entity_key IS NULL OR entity_key IN ('holdings', 'management', 'gp', 'fund')),
  fund_id             INTEGER REFERENCES vc_funds(id),
  limited_partner_id  INTEGER REFERENCES limited_partners(id),
  report_period_id    INTEGER REFERENCES fund_report_periods(id),
  period_label        TEXT NOT NULL CHECK (length(trim(period_label)) BETWEEN 1 AND 100),
  period_start        TEXT NOT NULL,
  period_end          TEXT NOT NULL,
  revision            INTEGER NOT NULL DEFAULT 1 CHECK (typeof(revision) = 'integer' AND revision >= 1),
  status              TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'prepared', 'issued', 'superseded')),
  figures_json        TEXT NOT NULL,
  figures_sha256      TEXT NOT NULL CHECK (length(figures_sha256) = 64 AND figures_sha256 NOT GLOB '*[^0-9a-f]*'),
  narrative_revision  TEXT,
  corrects_draft_id   INTEGER REFERENCES fund_report_drafts(id),
  built_by            INTEGER REFERENCES users(id),
  built_at            TEXT NOT NULL DEFAULT (datetime('now')),
  prepared_by         INTEGER REFERENCES users(id),
  prepared_at         TEXT,
  issued_by           INTEGER REFERENCES users(id),
  issued_at           TEXT,
  CHECK (period_start <= period_end),
  CHECK (status <> 'prepared' OR (prepared_by IS NOT NULL AND prepared_at IS NOT NULL)),
  CHECK (status <> 'issued' OR (prepared_by IS NOT NULL AND issued_by IS NOT NULL AND issued_at IS NOT NULL AND issued_by <> prepared_by))
);

-- One live draft (draft or prepared) per kind, subject and period.
CREATE UNIQUE INDEX IF NOT EXISTS idx_fund_report_drafts_live
  ON fund_report_drafts (kind, subject_key, period_label) WHERE status IN ('draft', 'prepared');
CREATE INDEX IF NOT EXISTS idx_fund_report_drafts_fund
  ON fund_report_drafts (fund_id, period_label, kind, status);
CREATE INDEX IF NOT EXISTS idx_fund_report_drafts_lp
  ON fund_report_drafts (limited_partner_id, status);

CREATE TRIGGER IF NOT EXISTS fund_report_drafts_block_delete
BEFORE DELETE ON fund_report_drafts
BEGIN
    SELECT RAISE(ABORT, 'fund_report_drafts is append-only (D712). Supersede a draft or correct an issued one instead.');
END;

CREATE TRIGGER IF NOT EXISTS fund_report_drafts_block_figures
BEFORE UPDATE OF figures_json, figures_sha256 ON fund_report_drafts
BEGIN
    SELECT RAISE(ABORT, 'fund_report_drafts figures are frozen (D712). A rebuild writes a new revision.');
END;

CREATE TRIGGER IF NOT EXISTS fund_report_drafts_block_identity
BEFORE UPDATE OF uid, kind, audience, subject_key, entity_key, fund_id, limited_partner_id, report_period_id,
  period_label, period_start, period_end, revision, corrects_draft_id, built_by, built_at ON fund_report_drafts
BEGIN
    SELECT RAISE(ABORT, 'fund_report_drafts identity is fixed (D712).');
END;

CREATE TRIGGER IF NOT EXISTS fund_report_drafts_block_closed
BEFORE UPDATE ON fund_report_drafts
WHEN OLD.status IN ('issued', 'superseded')
BEGIN
    SELECT RAISE(ABORT, 'An issued or superseded fund report draft cannot change (D712). Correct it with a new draft.');
END;

CREATE TRIGGER IF NOT EXISTS fund_report_drafts_block_transition
BEFORE UPDATE OF status ON fund_report_drafts
WHEN NEW.status <> OLD.status AND NOT (
     (OLD.status = 'draft' AND NEW.status IN ('prepared', 'superseded'))
  OR (OLD.status = 'prepared' AND NEW.status IN ('draft', 'superseded', 'issued')))
BEGIN
    SELECT RAISE(ABORT, 'That fund report draft state change is not allowed (D712).');
END;

CREATE TRIGGER IF NOT EXISTS fund_report_drafts_block_self_issue
BEFORE UPDATE OF status ON fund_report_drafts
WHEN NEW.status = 'issued' AND (NEW.issued_by IS NULL OR NEW.prepared_by IS NULL OR NEW.issued_by = NEW.prepared_by)
BEGIN
    SELECT RAISE(ABORT, 'The account that prepared a fund report draft cannot issue it (D712).');
END;

-- Every act on a draft, in order. `note` is a return reason or, on an
-- `issued` row, the typed acknowledgement of unmatched transactions, with
-- `unmatched_count` the count it acknowledged (decision 3). Sealed.
CREATE TABLE IF NOT EXISTS fund_report_draft_events (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  draft_id         INTEGER NOT NULL REFERENCES fund_report_drafts(id),
  action           TEXT NOT NULL CHECK (action IN ('built', 'viewed', 'exported', 'prepared', 'returned', 'issued', 'superseded')),
  actor            INTEGER REFERENCES users(id),
  note             TEXT CHECK (note IS NULL OR length(note) <= 500),
  unmatched_count  INTEGER CHECK (unmatched_count IS NULL OR (typeof(unmatched_count) = 'integer' AND unmatched_count >= 0)),
  created_at       TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_fund_report_draft_events_draft
  ON fund_report_draft_events (draft_id, id);

CREATE TRIGGER IF NOT EXISTS fund_report_draft_events_block_update
BEFORE UPDATE ON fund_report_draft_events
BEGIN
    SELECT RAISE(ABORT, 'fund_report_draft_events is append-only (D712).');
END;

CREATE TRIGGER IF NOT EXISTS fund_report_draft_events_block_delete
BEFORE DELETE ON fund_report_draft_events
BEGIN
    SELECT RAISE(ABORT, 'fund_report_draft_events is append-only (D712).');
END;
