-- 474 — Mercury as a read-only connector for fund administration (D710, #1775).
--
-- WHAT IT ADDS. One live Mercury connection per Axal entity (holdings,
-- management, gp, fund), which only a Super Admin adds; the accounts and
-- transactions its hourly read-only sync stores; one balance snapshot per
-- account per day; the matches that reconcile a bank credit against a
-- capital-call line or a management-fee period, which a person confirms; the
-- sync runs; and one unique index that lets a bank line become at most one
-- capital-call receipt.
--
-- NOTHING IN IT CAN MOVE MONEY. These tables hold what a read-only token read
-- back. No column holds a payment, a recipient or an instruction to Mercury.
--
-- NO ACCOUNT NUMBER IS STORED. An account is its Mercury id, its kind and its
-- last four digits (`services/mercury/parse.ts` drops the full account and
-- routing numbers at the boundary). The token is stored only as `v1.`
-- ciphertext from `encryptColumn(env, 'mercury_entity_connections',
-- 'credentials_enc', uid, …)`, and is NULL once the connection is
-- disconnected. Money is integer cents (`scripts/check-money-cents.mjs`).
--
-- Grepped first: no table here, and no `mercury_` table, exists in
-- schema_baseline.sql or an earlier migration. Seeds nothing.

CREATE TABLE IF NOT EXISTS mercury_entity_connections (
  id                      INTEGER PRIMARY KEY AUTOINCREMENT,
  uid                     TEXT NOT NULL UNIQUE,
  entity_key              TEXT NOT NULL CHECK (entity_key IN ('holdings', 'management', 'gp', 'fund')),
  status                  TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'error', 'disconnected')),
  credentials_enc         TEXT CHECK (credentials_enc IS NULL OR credentials_enc LIKE 'v1.%'),
  token_preview           TEXT,
  mercury_org_name        TEXT,
  connected_by            INTEGER NOT NULL REFERENCES users(id),
  connected_at            TEXT NOT NULL DEFAULT (datetime('now')),
  disconnected_by         INTEGER REFERENCES users(id),
  disconnected_at         TEXT,
  disconnect_reason       TEXT,
  last_synced_at          TEXT,
  last_sync_requested_at  TEXT,
  last_error              TEXT,
  last_error_at           TEXT,
  created_at              TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at              TEXT NOT NULL DEFAULT (datetime('now')),
  -- The token exists exactly while the connection does.
  CHECK ((status = 'disconnected') = (credentials_enc IS NULL))
);

-- One live connection per entity; a reconnect after a disconnect is a new row.
CREATE UNIQUE INDEX IF NOT EXISTS idx_mercury_connections_one_live
  ON mercury_entity_connections(entity_key) WHERE status <> 'disconnected';

CREATE TABLE IF NOT EXISTS mercury_accounts (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  uid                 TEXT NOT NULL UNIQUE,
  mercury_account_id  TEXT NOT NULL UNIQUE,
  connection_id       INTEGER NOT NULL REFERENCES mercury_entity_connections(id),
  entity_key          TEXT NOT NULL CHECK (entity_key IN ('holdings', 'management', 'gp', 'fund')),
  kind                TEXT NOT NULL CHECK (kind IN ('checking', 'savings')),
  last_four           TEXT NOT NULL CHECK (length(last_four) = 4 AND last_four NOT GLOB '*[^0-9]*'),
  nickname            TEXT,
  status              TEXT,
  -- 1 when #1773's registry names this account for this entity; 0 feeds no match.
  registered          INTEGER NOT NULL DEFAULT 0 CHECK (registered IN (0, 1)),
  current_cents       INTEGER,
  available_cents     INTEGER,
  balance_read_at     TEXT,
  created_at          TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at          TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_mercury_accounts_entity ON mercury_accounts(entity_key, connection_id);

CREATE TABLE IF NOT EXISTS mercury_balance_snapshots (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id       INTEGER NOT NULL REFERENCES mercury_accounts(id),
  as_of_date       TEXT NOT NULL,
  current_cents    INTEGER,
  available_cents  INTEGER,
  read_at          TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (account_id, as_of_date)
);

CREATE TABLE IF NOT EXISTS mercury_transactions (
  id                      INTEGER PRIMARY KEY AUTOINCREMENT,
  uid                     TEXT NOT NULL UNIQUE,
  mercury_transaction_id  TEXT NOT NULL UNIQUE,
  account_id              INTEGER NOT NULL REFERENCES mercury_accounts(id),
  amount_cents            INTEGER NOT NULL,
  currency                TEXT NOT NULL DEFAULT 'usd' CHECK (currency = 'usd'),
  created_on              TEXT,
  posted_on               TEXT,
  counterparty_name       TEXT,
  memo                    TEXT,
  status                  TEXT,
  kind                    TEXT,
  created_at              TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at              TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_mercury_transactions_account ON mercury_transactions(account_id, created_on);

CREATE TABLE IF NOT EXISTS mercury_matches (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  uid                TEXT NOT NULL UNIQUE,
  transaction_id     INTEGER NOT NULL REFERENCES mercury_transactions(id),
  target_kind        TEXT NOT NULL CHECK (target_kind IN ('capital_call_line', 'fee_period')),
  -- No foreign key: the table depends on the kind.
  target_id          INTEGER NOT NULL,
  state              TEXT NOT NULL DEFAULT 'proposed' CHECK (state IN ('proposed', 'confirmed', 'rejected', 'needs_review')),
  origin             TEXT NOT NULL CHECK (origin IN ('matcher', 'manual')),
  amount_cents       INTEGER NOT NULL CHECK (amount_cents > 0),
  proposed_by        INTEGER REFERENCES users(id),
  proposed_at        TEXT NOT NULL DEFAULT (datetime('now')),
  confirmed_by       INTEGER REFERENCES users(id),
  confirmed_at       TEXT,
  rejected_by        INTEGER REFERENCES users(id),
  rejected_at        TEXT,
  reason             TEXT,
  receipt_id         INTEGER REFERENCES capital_call_receipts(id),
  created_at         TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at         TEXT NOT NULL DEFAULT (datetime('now')),
  -- A rejected pair is remembered, so it is never proposed again.
  UNIQUE (transaction_id, target_kind, target_id)
);
-- One bank line has one live match.
CREATE UNIQUE INDEX IF NOT EXISTS idx_mercury_matches_one_live_per_line
  ON mercury_matches(transaction_id) WHERE state <> 'rejected';
-- A fee period takes one live match.
CREATE UNIQUE INDEX IF NOT EXISTS idx_mercury_matches_one_live_per_fee_period
  ON mercury_matches(target_id) WHERE target_kind = 'fee_period' AND state <> 'rejected';
CREATE UNIQUE INDEX IF NOT EXISTS idx_mercury_matches_receipt
  ON mercury_matches(receipt_id) WHERE receipt_id IS NOT NULL;

CREATE TRIGGER IF NOT EXISTS mercury_matches_block_delete
BEFORE DELETE ON mercury_matches
BEGIN
    SELECT RAISE(ABORT,
        'mercury_matches is append-only (D710). Reject a match with a reason instead of deleting it.'
    );
END;

CREATE TABLE IF NOT EXISTS mercury_sync_runs (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  connection_id       INTEGER NOT NULL REFERENCES mercury_entity_connections(id),
  trigger             TEXT NOT NULL CHECK (trigger IN ('cron', 'connect', 'manual')),
  started_at          TEXT NOT NULL DEFAULT (datetime('now')),
  finished_at         TEXT,
  status              TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'ok', 'partial', 'error')),
  accounts_seen       INTEGER NOT NULL DEFAULT 0,
  transactions_seen   INTEGER NOT NULL DEFAULT 0,
  transactions_stored INTEGER NOT NULL DEFAULT 0,
  refused_count       INTEGER NOT NULL DEFAULT 0,
  error_code          TEXT
);
CREATE INDEX IF NOT EXISTS idx_mercury_sync_runs_connection ON mercury_sync_runs(connection_id, started_at DESC);

-- A bank line becomes at most one capital-call receipt. `substr`, not LIKE,
-- so the match is exact and case-sensitive.
CREATE UNIQUE INDEX IF NOT EXISTS idx_capital_call_receipts_mercury_once
  ON capital_call_receipts(reference) WHERE substr(reference, 1, 8) = 'mercury:';
