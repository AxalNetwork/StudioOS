-- D1217 (#3214): company-owned receiving instructions and sender-only reports.
-- Instructions are authenticated ciphertext bound to each immutable version uid.
-- Retained versions pin each audited attempt without digits in the ledger.
-- Outcome distinguishes failed validation from a prepared full-number response;
-- prepared does not prove client delivery or viewing. Immutable source UIDs
-- survive source deletion without retaining bank data. No payment hold.
CREATE TABLE IF NOT EXISTS company_receiving_accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  company_id INTEGER NOT NULL REFERENCES company_profiles(id) ON DELETE CASCADE,
  revision INTEGER NOT NULL CHECK (revision > 0),
  instructions_enc TEXT NOT NULL,
  account_last4 TEXT NOT NULL CHECK (length(account_last4) = 4),
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (company_id, revision)
);
CREATE UNIQUE INDEX IF NOT EXISTS company_receiving_accounts_active
  ON company_receiving_accounts(company_id) WHERE is_active = 1;
CREATE TABLE IF NOT EXISTS company_receiving_account_reveals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  account_id INTEGER REFERENCES company_receiving_accounts(id) ON DELETE SET NULL,
  account_uid TEXT NOT NULL,
  company_uid TEXT NOT NULL,
  actor_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  commitment_id INTEGER REFERENCES commitments(id) ON DELETE SET NULL,
  outcome TEXT NOT NULL DEFAULT 'pending' CHECK (outcome IN ('pending', 'unreadable', 'currency_mismatch', 'prepared')),
  attempted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  prepared_at TEXT,
  CHECK ((outcome = 'prepared' AND prepared_at IS NOT NULL) OR (outcome <> 'prepared' AND prepared_at IS NULL))
);
CREATE INDEX IF NOT EXISTS company_receiving_account_reveals_account
  ON company_receiving_account_reveals(account_id, attempted_at);

-- #3214 explicitly permits the commitment until D1215's closing line lands.
-- These report a sender's claim; the existing pending/confirmed/withdrawn status
-- and every receiving-side aggregate stay authoritative and unchanged.
ALTER TABLE commitments ADD COLUMN sent_at TEXT;
ALTER TABLE commitments ADD COLUMN sent_on TEXT;
ALTER TABLE commitments ADD COLUMN sent_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE commitments ADD COLUMN sent_source_ref TEXT;
ALTER TABLE commitments ADD COLUMN sent_proposal_uid TEXT;
ALTER TABLE commitments ADD COLUMN sent_amount_cents INTEGER CHECK (sent_amount_cents IS NULL OR (typeof(sent_amount_cents) = 'integer' AND sent_amount_cents > 0));
ALTER TABLE commitments ADD COLUMN sent_currency TEXT CHECK (sent_currency IS NULL OR (length(sent_currency) = 3 AND sent_currency GLOB '[A-Z][A-Z][A-Z]'));
