-- 472 — entity_bank_accounts and entity_bank_account_reveals: each Axal
-- entity's bank accounts, encrypted at rest, and a ledger of every time a full
-- number was shown (D708, #1773).
--
-- WHY. A notice that asks someone to wire money must print the payee's own
-- account, or say why it cannot. Until this migration the platform held no bank
-- details for any entity. Grepped first: `account_number`, `routing_number`,
-- `bank_account`, `wire_instructions` and `Mercury` appear nowhere in
-- `cloudflare-worker/sql` or `cloudflare-worker/src`, so every column and both
-- tables below are new.
--
-- entity_bank_accounts — one row per account, keyed on the entity's key in
-- `services/legalDocFormat.ts` (`AxalEntityKey`), not on `entities.id`, which
-- production may lack for some of the four.
--   account_number_enc  the full number, AES-256-GCM through
--                       services/columnCipher.ts with the AAD
--                       `entity_bank_accounts:account_number_enc:<uid>`, so a
--                       ciphertext copied onto another row does not decrypt.
--                       The CHECK holds the cipher's `v1.` prefix: never
--                       plaintext. The uid is minted before the insert.
--   account_last4       the last four digits, the only part a list shows.
--   routing_number ...  the bank's identifiers (ABA, alternate ABA, SWIFT and
--                       the intermediary's SWIFT), public, in plain text.
--   purposes_json       which payments this account takes (D708 decision 4);
--                       `services/entityBankAccounts.ts` validates the list.
--
-- PAYMENT INSTRUCTIONS NEVER CHANGE IN PLACE (decision 3). A changed account
-- number is how wire fraud looks, so the triggers below refuse a DELETE, an
-- UPDATE of any instruction column or of `uid`, `recorded_by` or `created_at`,
-- and any UPDATE of a retired row. Only `label`, `purposes_json` and the
-- retirement (`status`, `retired_at`, `retired_reason`, `updated_at`) change.
-- To change an account, retire the row and add another.
--
-- entity_bank_account_reveals — one row per full number shown, written BEFORE
-- the number is decrypted (decision 6): `admin_reveal` from the Super Admin's
-- console, with the reason as `context_ref`, or `capital_call_line` from an
-- LP's own open line, with the line id. Append-only by trigger, as migration
-- 312 seals its receipts.
--
-- SEEDS NOTHING (decision 7). No migration or script writes an account; the
-- owner types each number into the console after deploy.
--
-- Idempotent: CREATE TABLE / INDEX / TRIGGER IF NOT EXISTS. No `BEGIN`/
-- `COMMIT` statements: each `BEGIN` below opens a trigger body, which
-- `scripts/check-sql-migrations.mjs` allows.

CREATE TABLE IF NOT EXISTS entity_bank_accounts (
  id                      INTEGER PRIMARY KEY AUTOINCREMENT,
  uid                     TEXT NOT NULL UNIQUE,
  entity_key              TEXT NOT NULL CHECK (entity_key IN ('holdings', 'management', 'gp', 'fund')),
  label                   TEXT NOT NULL CHECK (length(label) BETWEEN 1 AND 60),
  bank_name               TEXT NOT NULL CHECK (length(bank_name) BETWEEN 1 AND 120),
  bank_address            TEXT NOT NULL CHECK (length(bank_address) BETWEEN 1 AND 200),
  beneficiary_name        TEXT NOT NULL CHECK (length(beneficiary_name) BETWEEN 1 AND 120),
  beneficiary_address     TEXT NOT NULL CHECK (length(beneficiary_address) BETWEEN 1 AND 200),
  account_kind            TEXT NOT NULL CHECK (account_kind IN ('checking', 'savings')),
  account_number_enc      TEXT NOT NULL CHECK (account_number_enc LIKE 'v1.%'),
  account_last4           TEXT NOT NULL CHECK (length(account_last4) = 4 AND account_last4 GLOB '[0-9][0-9][0-9][0-9]'),
  routing_number          TEXT NOT NULL CHECK (length(routing_number) = 9 AND routing_number NOT GLOB '*[^0-9]*'),
  routing_number_alt      TEXT CHECK (routing_number_alt IS NULL OR (length(routing_number_alt) = 9 AND routing_number_alt NOT GLOB '*[^0-9]*')),
  swift_code              TEXT CHECK (swift_code IS NULL OR length(swift_code) IN (8, 11)),
  intermediary_swift_code TEXT CHECK (intermediary_swift_code IS NULL OR length(intermediary_swift_code) IN (8, 11)),
  purposes_json           TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(purposes_json) AND json_type(purposes_json) = 'array'),
  status                  TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'retired')),
  retired_at              TEXT,
  retired_reason          TEXT CHECK (retired_reason IS NULL OR length(retired_reason) <= 200),
  recorded_by             INTEGER NOT NULL REFERENCES users(id),
  created_at              TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at              TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (status = 'active' OR retired_at IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_entity_bank_accounts_entity_status
  ON entity_bank_accounts(entity_key, status);

CREATE TABLE IF NOT EXISTS entity_bank_account_reveals (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  uid           TEXT NOT NULL UNIQUE,
  account_id    INTEGER NOT NULL REFERENCES entity_bank_accounts(id),
  actor_user_id INTEGER NOT NULL REFERENCES users(id),
  context       TEXT NOT NULL CHECK (context IN ('admin_reveal', 'capital_call_line')),
  context_ref   TEXT CHECK (context_ref IS NULL OR length(context_ref) BETWEEN 1 AND 200),
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_entity_bank_account_reveals_account
  ON entity_bank_account_reveals(account_id, created_at DESC);

-- ------------------------------------------------------------------ the seals
CREATE TRIGGER IF NOT EXISTS entity_bank_accounts_block_delete
BEFORE DELETE ON entity_bank_accounts
BEGIN
    SELECT RAISE(ABORT,
        'entity_bank_accounts keeps every account (D708). Retire it instead of deleting it.'
    );
END;

CREATE TRIGGER IF NOT EXISTS entity_bank_accounts_block_retired_update
BEFORE UPDATE ON entity_bank_accounts
WHEN OLD.status = 'retired'
BEGIN
    SELECT RAISE(ABORT,
        'entity_bank_accounts: a retired account is never changed (D708). Add a new account instead.'
    );
END;

CREATE TRIGGER IF NOT EXISTS entity_bank_accounts_block_instruction_update
BEFORE UPDATE ON entity_bank_accounts
WHEN NEW.uid IS NOT OLD.uid
  OR NEW.entity_key IS NOT OLD.entity_key
  OR NEW.bank_name IS NOT OLD.bank_name
  OR NEW.bank_address IS NOT OLD.bank_address
  OR NEW.beneficiary_name IS NOT OLD.beneficiary_name
  OR NEW.beneficiary_address IS NOT OLD.beneficiary_address
  OR NEW.account_kind IS NOT OLD.account_kind
  OR NEW.account_number_enc IS NOT OLD.account_number_enc
  OR NEW.account_last4 IS NOT OLD.account_last4
  OR NEW.routing_number IS NOT OLD.routing_number
  OR NEW.routing_number_alt IS NOT OLD.routing_number_alt
  OR NEW.swift_code IS NOT OLD.swift_code
  OR NEW.intermediary_swift_code IS NOT OLD.intermediary_swift_code
  OR NEW.recorded_by IS NOT OLD.recorded_by
  OR NEW.created_at IS NOT OLD.created_at
BEGIN
    SELECT RAISE(ABORT,
        'entity_bank_accounts: payment instructions never change in place (D708). Retire this account and add the new one.'
    );
END;

CREATE TRIGGER IF NOT EXISTS entity_bank_account_reveals_block_update
BEFORE UPDATE ON entity_bank_account_reveals
BEGIN
    SELECT RAISE(ABORT,
        'entity_bank_account_reveals is append-only (D708). A reveal, once recorded, is never rewritten.'
    );
END;

CREATE TRIGGER IF NOT EXISTS entity_bank_account_reveals_block_delete
BEFORE DELETE ON entity_bank_account_reveals
BEGIN
    SELECT RAISE(ABORT,
        'entity_bank_account_reveals is append-only (D708). Deleting a reveal would remove the record that a number was shown.'
    );
END;
