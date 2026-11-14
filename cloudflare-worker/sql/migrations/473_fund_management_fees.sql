-- 473_fund_management_fees.sql — D709 (#1774): the 2% management fee's terms,
-- each LP's admission date, the Fund's net invested capital, offsets, and the
-- fee periods and lines the GP previews and issues. Issuing records amounts
-- and a payment reference; nothing here moves money.
--
-- Grep first (D-t): none of these six tables exists in schema_baseline.sql or
-- in any migration before this one (471 was the newest on main when it was
-- written; 470 to 479 are reserved, and S1 gave this task 473). They are new
-- rather than D628's: `fund_fee_terms` (418) holds one basis figure for the
-- books, and this fee derives each LP's. D709 never reads or writes D628's
-- tables or `vc_funds.management_fee`.
--
--   fund_mgmt_fee_terms — decision 1. Versioned per fund, written `draft`;
--     only POST …/confirm makes a row `confirmed`, and only a confirmed row
--     bills. Confirmed versions never share an `effective_from`.
--   fund_lp_admissions — decision 2. Each LP's admission (closing) date, with
--     its source, recorded and never inferred from `commitment_date`. Frozen
--     once that LP has a fee line that is not a draft.
--   fund_net_invested_capital — decision 3. The figure the GP records, as of a
--     date, with a source. Append-only.
--   fund_fee_offsets — decision 6. A fee a portfolio company paid an Axal
--     entity. The only change is the first `counted_in_period_id`.
--   fund_fee_periods / fund_fee_lines — decision 7. `draft` → `issued` →
--     `paid`. Once not a draft, only the status (forward) and `paid_at` move,
--     and a line's call link is set once. A draft may be deleted, so a fresh
--     preview replaces it.
--
-- Money is integer cents, rates basis points; dates are YYYY-MM-DD text and
-- `*_at` stamps are datetime('now'). STANDS ALONE and idempotent under the
-- runner: IF NOT EXISTS everywhere, no BEGIN/COMMIT outside a trigger body.

CREATE TABLE IF NOT EXISTS fund_mgmt_fee_terms (
  id                     INTEGER PRIMARY KEY AUTOINCREMENT,
  uid                    TEXT NOT NULL UNIQUE,
  fund_id                INTEGER NOT NULL REFERENCES vc_funds(id) ON DELETE CASCADE,
  annual_bps             INTEGER NOT NULL DEFAULT 200 CHECK (annual_bps BETWEEN 0 AND 10000),
  basis_during           TEXT NOT NULL DEFAULT 'committed' CHECK (basis_during = 'committed'),
  basis_after            TEXT NOT NULL DEFAULT 'net_invested' CHECK (basis_after IN ('net_invested', 'committed')),
  frequency              TEXT NOT NULL DEFAULT 'quarterly_in_advance' CHECK (frequency = 'quarterly_in_advance'),
  payee                  TEXT NOT NULL DEFAULT 'gp' CHECK (payee = 'gp'),
  offset_bps             INTEGER NOT NULL DEFAULT 10000 CHECK (offset_bps BETWEEN 0 AND 10000),
  fee_start_date         TEXT NOT NULL CHECK (length(fee_start_date) = 10),
  investment_period_end  TEXT NOT NULL CHECK (length(investment_period_end) = 10 AND investment_period_end >= fee_start_date),
  effective_from         TEXT NOT NULL CHECK (length(effective_from) = 10 AND effective_from >= fee_start_date),
  lpa_reference          TEXT NOT NULL CHECK (length(trim(lpa_reference)) BETWEEN 1 AND 500),
  status                 TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'confirmed')),
  recorded_by            INTEGER REFERENCES users(id),
  confirmed_by           INTEGER REFERENCES users(id),
  confirmed_at           TEXT,
  created_at             TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at             TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK ((status = 'confirmed') = (confirmed_at IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_fund_mgmt_fee_terms_confirmed
  ON fund_mgmt_fee_terms(fund_id, effective_from) WHERE status = 'confirmed';
CREATE INDEX IF NOT EXISTS idx_fund_mgmt_fee_terms_fund ON fund_mgmt_fee_terms(fund_id, status);

CREATE TABLE IF NOT EXISTS fund_lp_admissions (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  uid                 TEXT NOT NULL UNIQUE,
  fund_id             INTEGER NOT NULL REFERENCES vc_funds(id) ON DELETE CASCADE,
  limited_partner_id  INTEGER NOT NULL UNIQUE REFERENCES limited_partners(id) ON DELETE CASCADE,
  admitted_on         TEXT NOT NULL CHECK (length(admitted_on) = 10),
  closing_label       TEXT CHECK (closing_label IS NULL OR length(closing_label) <= 200),
  source              TEXT NOT NULL CHECK (length(trim(source)) BETWEEN 1 AND 500),
  recorded_by         INTEGER REFERENCES users(id),
  created_at          TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at          TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_fund_lp_admissions_fund ON fund_lp_admissions(fund_id);

CREATE TABLE IF NOT EXISTS fund_net_invested_capital (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  uid                 TEXT NOT NULL UNIQUE,
  fund_id             INTEGER NOT NULL REFERENCES vc_funds(id) ON DELETE CASCADE,
  as_of               TEXT NOT NULL CHECK (length(as_of) = 10),
  net_invested_cents  INTEGER NOT NULL CHECK (net_invested_cents >= 0),
  source              TEXT NOT NULL CHECK (length(trim(source)) BETWEEN 1 AND 500),
  recorded_by         INTEGER REFERENCES users(id),
  created_at          TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at          TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_fund_net_invested_fund ON fund_net_invested_capital(fund_id, as_of DESC);

CREATE TABLE IF NOT EXISTS fund_fee_periods (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  uid                   TEXT NOT NULL UNIQUE,
  fund_id               INTEGER NOT NULL REFERENCES vc_funds(id) ON DELETE CASCADE,
  quarter               TEXT NOT NULL CHECK (length(quarter) = 6 AND substr(quarter, 5, 1) = 'Q' AND substr(quarter, 6, 1) IN ('1', '2', '3', '4')),
  window_start          TEXT NOT NULL CHECK (length(window_start) = 10),
  window_end            TEXT NOT NULL CHECK (length(window_end) = 10 AND window_end >= window_start),
  terms_id              INTEGER NOT NULL REFERENCES fund_mgmt_fee_terms(id),
  net_invested_id       INTEGER REFERENCES fund_net_invested_capital(id),
  status                TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'issued', 'paid')),
  digest                TEXT NOT NULL CHECK (length(digest) = 64),
  gross_cents           INTEGER NOT NULL CHECK (gross_cents >= 0),
  catch_up_cents        INTEGER NOT NULL CHECK (catch_up_cents >= 0),
  offset_pool_cents     INTEGER NOT NULL CHECK (offset_pool_cents >= 0),
  offset_applied_cents  INTEGER NOT NULL CHECK (offset_applied_cents >= 0 AND offset_applied_cents <= offset_pool_cents),
  offset_carried_cents  INTEGER NOT NULL CHECK (offset_carried_cents = offset_pool_cents - offset_applied_cents),
  net_cents             INTEGER NOT NULL CHECK (net_cents = gross_cents + catch_up_cents - offset_applied_cents),
  remittance_reference  TEXT NOT NULL UNIQUE,
  issued_by             INTEGER REFERENCES users(id),
  issued_at             TEXT,
  paid_at               TEXT,
  created_at            TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at            TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (fund_id, quarter)
);

CREATE TABLE IF NOT EXISTS fund_fee_offsets (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  uid                   TEXT NOT NULL UNIQUE,
  fund_id               INTEGER NOT NULL REFERENCES vc_funds(id) ON DELETE CASCADE,
  project_id            INTEGER NOT NULL REFERENCES projects(id),
  axal_entity           TEXT NOT NULL CHECK (axal_entity IN ('holdings', 'management', 'gp')),
  amount_cents          INTEGER NOT NULL CHECK (amount_cents > 0),
  received_on           TEXT NOT NULL CHECK (length(received_on) = 10),
  description           TEXT NOT NULL CHECK (length(trim(description)) BETWEEN 1 AND 500),
  source                TEXT NOT NULL CHECK (length(trim(source)) BETWEEN 1 AND 500),
  counted_in_period_id  INTEGER REFERENCES fund_fee_periods(id),
  recorded_by           INTEGER REFERENCES users(id),
  created_at            TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at            TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_fund_fee_offsets_fund ON fund_fee_offsets(fund_id, counted_in_period_id);

CREATE TABLE IF NOT EXISTS fund_fee_lines (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  uid                   TEXT NOT NULL UNIQUE,
  period_id             INTEGER NOT NULL REFERENCES fund_fee_periods(id) ON DELETE CASCADE,
  fund_id               INTEGER NOT NULL REFERENCES vc_funds(id) ON DELETE CASCADE,
  limited_partner_id    INTEGER NOT NULL REFERENCES limited_partners(id),
  commitment_cents      INTEGER NOT NULL CHECK (commitment_cents > 0),
  committed_days        INTEGER NOT NULL CHECK (committed_days >= 0),
  invested_days         INTEGER NOT NULL CHECK (invested_days >= 0),
  invested_share_cents  INTEGER CHECK ((invested_days = 0) = (invested_share_cents IS NULL) AND (invested_share_cents IS NULL OR invested_share_cents >= 0)),
  gross_fee_cents       INTEGER NOT NULL CHECK (gross_fee_cents >= 0),
  catch_up_days         INTEGER NOT NULL DEFAULT 0 CHECK (catch_up_days >= 0),
  catch_up_cents        INTEGER NOT NULL DEFAULT 0 CHECK (catch_up_cents >= 0),
  offset_cents          INTEGER NOT NULL DEFAULT 0 CHECK (offset_cents >= 0),
  net_fee_cents         INTEGER NOT NULL CHECK (net_fee_cents = gross_fee_cents + catch_up_cents - offset_cents AND net_fee_cents >= 0),
  reference_code        TEXT NOT NULL UNIQUE,
  capital_call_line_id  INTEGER REFERENCES capital_calls(id),
  status                TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'issued', 'paid')),
  paid_via              TEXT CHECK (paid_via IS NULL OR paid_via = 'capital_call'),
  paid_evidence         TEXT,
  paid_at               TEXT,
  created_at            TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at            TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (period_id, limited_partner_id)
);
CREATE INDEX IF NOT EXISTS idx_fund_fee_lines_lp ON fund_fee_lines(limited_partner_id, status);
CREATE INDEX IF NOT EXISTS idx_fund_fee_lines_call ON fund_fee_lines(capital_call_line_id);

-- ------------------------------------------------------------------ the seals
CREATE TRIGGER IF NOT EXISTS fund_mgmt_fee_terms_block_delete
BEFORE DELETE ON fund_mgmt_fee_terms
BEGIN
    SELECT RAISE(ABORT, 'fund_mgmt_fee_terms is append-only (D709). Record a new version instead.');
END;

CREATE TRIGGER IF NOT EXISTS fund_mgmt_fee_terms_confirm_only
BEFORE UPDATE ON fund_mgmt_fee_terms
WHEN NOT (OLD.status = 'draft' AND NEW.status = 'confirmed'
  AND NEW.id = OLD.id AND NEW.uid = OLD.uid AND NEW.fund_id = OLD.fund_id AND NEW.annual_bps = OLD.annual_bps
  AND NEW.basis_during = OLD.basis_during AND NEW.basis_after = OLD.basis_after AND NEW.frequency = OLD.frequency
  AND NEW.payee = OLD.payee AND NEW.offset_bps = OLD.offset_bps AND NEW.fee_start_date = OLD.fee_start_date
  AND NEW.investment_period_end = OLD.investment_period_end AND NEW.effective_from = OLD.effective_from
  AND NEW.lpa_reference = OLD.lpa_reference AND NEW.recorded_by IS OLD.recorded_by)
BEGIN
    SELECT RAISE(ABORT, 'fund_mgmt_fee_terms changes only from draft to confirmed (D709). Record a new version instead.');
END;

CREATE TRIGGER IF NOT EXISTS fund_lp_admissions_frozen_update
BEFORE UPDATE ON fund_lp_admissions
WHEN EXISTS (SELECT 1 FROM fund_fee_lines l WHERE l.limited_partner_id = OLD.limited_partner_id AND l.status <> 'draft')
BEGIN
    SELECT RAISE(ABORT, 'This LP has an issued fee line, so its admission date is fixed (D709).');
END;

CREATE TRIGGER IF NOT EXISTS fund_lp_admissions_frozen_delete
BEFORE DELETE ON fund_lp_admissions
WHEN EXISTS (SELECT 1 FROM fund_fee_lines l WHERE l.limited_partner_id = OLD.limited_partner_id AND l.status <> 'draft')
BEGIN
    SELECT RAISE(ABORT, 'This LP has an issued fee line, so its admission date is fixed (D709).');
END;

CREATE TRIGGER IF NOT EXISTS fund_net_invested_block_update
BEFORE UPDATE ON fund_net_invested_capital
BEGIN
    SELECT RAISE(ABORT, 'fund_net_invested_capital is append-only (D709). Record a new figure as of its date instead.');
END;

CREATE TRIGGER IF NOT EXISTS fund_net_invested_block_delete
BEFORE DELETE ON fund_net_invested_capital
BEGIN
    SELECT RAISE(ABORT, 'fund_net_invested_capital is append-only (D709).');
END;

CREATE TRIGGER IF NOT EXISTS fund_fee_offsets_block_delete
BEFORE DELETE ON fund_fee_offsets
BEGIN
    SELECT RAISE(ABORT, 'fund_fee_offsets is append-only (D709).');
END;

CREATE TRIGGER IF NOT EXISTS fund_fee_offsets_count_once
BEFORE UPDATE ON fund_fee_offsets
WHEN NOT (OLD.counted_in_period_id IS NULL AND NEW.counted_in_period_id IS NOT NULL
  AND NEW.id = OLD.id AND NEW.uid = OLD.uid AND NEW.fund_id = OLD.fund_id AND NEW.project_id = OLD.project_id
  AND NEW.axal_entity = OLD.axal_entity AND NEW.amount_cents = OLD.amount_cents AND NEW.received_on = OLD.received_on
  AND NEW.description = OLD.description AND NEW.source = OLD.source AND NEW.recorded_by IS OLD.recorded_by)
BEGIN
    SELECT RAISE(ABORT, 'An offset changes only once, when an issued period counts it (D709).');
END;

CREATE TRIGGER IF NOT EXISTS fund_fee_periods_frozen
BEFORE UPDATE ON fund_fee_periods
WHEN OLD.status <> 'draft' AND NOT (
  NEW.id = OLD.id AND NEW.uid = OLD.uid AND NEW.fund_id = OLD.fund_id AND NEW.quarter = OLD.quarter
  AND NEW.window_start = OLD.window_start AND NEW.window_end = OLD.window_end AND NEW.terms_id = OLD.terms_id
  AND NEW.net_invested_id IS OLD.net_invested_id AND NEW.digest = OLD.digest AND NEW.gross_cents = OLD.gross_cents
  AND NEW.catch_up_cents = OLD.catch_up_cents AND NEW.offset_pool_cents = OLD.offset_pool_cents
  AND NEW.offset_applied_cents = OLD.offset_applied_cents AND NEW.offset_carried_cents = OLD.offset_carried_cents
  AND NEW.net_cents = OLD.net_cents AND NEW.remittance_reference = OLD.remittance_reference
  AND NEW.issued_by IS OLD.issued_by AND NEW.issued_at IS OLD.issued_at)
BEGIN
    SELECT RAISE(ABORT, 'An issued fee period is fixed; only its status and paid date move (D709).');
END;

CREATE TRIGGER IF NOT EXISTS fund_fee_periods_status_forward
BEFORE UPDATE OF status ON fund_fee_periods
WHEN NOT (NEW.status = OLD.status OR (OLD.status = 'draft' AND NEW.status = 'issued') OR (OLD.status = 'issued' AND NEW.status = 'paid'))
BEGIN
    SELECT RAISE(ABORT, 'A fee period moves only from draft to issued to paid (D709).');
END;

CREATE TRIGGER IF NOT EXISTS fund_fee_periods_delete_draft
BEFORE DELETE ON fund_fee_periods
WHEN OLD.status <> 'draft'
BEGIN
    SELECT RAISE(ABORT, 'Only a draft fee period can be deleted (D709).');
END;

CREATE TRIGGER IF NOT EXISTS fund_fee_lines_frozen
BEFORE UPDATE ON fund_fee_lines
WHEN OLD.status <> 'draft' AND NOT (
  NEW.id = OLD.id AND NEW.uid = OLD.uid AND NEW.period_id = OLD.period_id AND NEW.fund_id = OLD.fund_id
  AND NEW.limited_partner_id = OLD.limited_partner_id AND NEW.commitment_cents = OLD.commitment_cents
  AND NEW.committed_days = OLD.committed_days AND NEW.invested_days = OLD.invested_days
  AND NEW.invested_share_cents IS OLD.invested_share_cents AND NEW.gross_fee_cents = OLD.gross_fee_cents
  AND NEW.catch_up_days = OLD.catch_up_days AND NEW.catch_up_cents = OLD.catch_up_cents
  AND NEW.offset_cents = OLD.offset_cents AND NEW.net_fee_cents = OLD.net_fee_cents AND NEW.reference_code = OLD.reference_code)
BEGIN
    SELECT RAISE(ABORT, 'An issued fee line is fixed; only its status, call link and payment move (D709).');
END;

CREATE TRIGGER IF NOT EXISTS fund_fee_lines_status_forward
BEFORE UPDATE OF status ON fund_fee_lines
WHEN NOT (NEW.status = OLD.status OR (OLD.status = 'draft' AND NEW.status = 'issued') OR (OLD.status = 'issued' AND NEW.status = 'paid'))
BEGIN
    SELECT RAISE(ABORT, 'A fee line moves only from draft to issued to paid (D709).');
END;

CREATE TRIGGER IF NOT EXISTS fund_fee_lines_call_once
BEFORE UPDATE OF capital_call_line_id ON fund_fee_lines
WHEN OLD.capital_call_line_id IS NOT NULL AND NEW.capital_call_line_id IS NOT OLD.capital_call_line_id
BEGIN
    SELECT RAISE(ABORT, 'A fee line links to one call line, once (D709).');
END;

CREATE TRIGGER IF NOT EXISTS fund_fee_lines_delete_draft
BEFORE DELETE ON fund_fee_lines
WHEN OLD.status <> 'draft'
BEGIN
    SELECT RAISE(ABORT, 'Only a draft fee line can be deleted (D709).');
END;
