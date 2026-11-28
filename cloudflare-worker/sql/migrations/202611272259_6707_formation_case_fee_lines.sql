-- D6707 (#6707, plan key E15 of #6680): the fee lines a formation case was
-- quoted, snapshotted on the case at quote time.
--
--   formation_case_fee_lines  one line of one quote of one case, as the founder
--                             read it: who is paid (payee), who collects it
--                             (collected_by), when (timing), the currency and
--                             the amount in integer minor units, or NULL ("Not
--                             recorded", never 0), its source and the day that
--                             source was checked.
--
-- A quote is every row with one `quote_uid`; a later quote adds rows under a
-- new uid and never changes an earlier one. A partner line names the firm
-- (`formation_partner_id`) and its founder price only: a partner's cost
-- (`formation_partner_prices.cost_minor`) is never copied here. The writer is
-- routes/legal_incorporation_quote.ts over services/incorporationQuote.ts
-- `snapshotStatements`, tested in
-- cloudflare-worker/test/incorporation_fee_lines_6707.test.ts.
--
-- Grep first: no table named formation_case_fee_lines exists in
-- schema_baseline.sql or any migration. Additive only: one new table and its
-- index, each `IF NOT EXISTS`. STANDS ALONE under the runner: no BEGIN/COMMIT.

CREATE TABLE IF NOT EXISTS formation_case_fee_lines (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  case_id               INTEGER NOT NULL REFERENCES formation_cases(id),
  quote_uid             TEXT NOT NULL CHECK (length(quote_uid) BETWEEN 1 AND 64),
  position              INTEGER NOT NULL CHECK (typeof(position) = 'integer' AND position >= 0),
  line_key              TEXT NOT NULL CHECK (length(line_key) BETWEEN 1 AND 96),
  label                 TEXT NOT NULL CHECK (length(label) BETWEEN 1 AND 200),
  payee                 TEXT NOT NULL CHECK (payee IN ('axal', 'partner', 'government')),
  payee_name            TEXT CHECK (payee_name IS NULL OR length(payee_name) <= 200),
  collected_by          TEXT NOT NULL CHECK (collected_by IN ('axal', 'partner', 'government')),
  timing                TEXT NOT NULL CHECK (timing IN ('at_order', 'at_filing', 'yearly', 'monthly')),
  currency              TEXT CHECK (currency IS NULL OR (length(currency) = 3 AND currency = lower(currency))),
  amount_minor          INTEGER CHECK (amount_minor IS NULL OR (typeof(amount_minor) = 'integer' AND amount_minor > 0)),
  optional              INTEGER NOT NULL DEFAULT 0 CHECK (optional IN (0, 1)),
  source                TEXT CHECK (source IS NULL OR length(source) <= 300),
  source_url            TEXT CHECK (source_url IS NULL OR length(source_url) <= 2000),
  checked_on            TEXT CHECK (checked_on IS NULL OR checked_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  formation_partner_id  INTEGER REFERENCES formation_partners(id),
  catalogue_version_id  INTEGER REFERENCES formation_catalogue_versions(id),
  quoted_by             INTEGER,
  quoted_at             TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (amount_minor IS NULL OR currency IS NOT NULL),
  UNIQUE (case_id, quote_uid, position)
);
CREATE INDEX IF NOT EXISTS idx_formation_case_fee_lines_case
  ON formation_case_fee_lines(case_id, quoted_at);
