-- 624 — Closing part 3 (D1216, #3213): an envelope signed in order by several
-- parties, with an optional Axal countersign stage. Assigned to #3213 by S21
-- for S1.
--
-- WHY NEW TABLES. The subscription booklet's stages (485,
-- `fund_booklet_envelopes`) belong to a booklet: `booklet_id NOT NULL`, two
-- stages (`applicant`, `gp`) and triggers keyed on the booklet's status and
-- digest. A SAFE, SPA or SPV Joinder between the company, the investor and
-- Axal has no booklet and three stages. `esign_recipients` has no order and no
-- role. So the booklet stays as it is, and a closing line's paper gets these.
--
-- esign_staged_envelopes — one document signed in order. `digest` is the
--   SHA-256 of `body`, the exact text every stage signs: each stage is a
--   single-recipient envelope sent with `createAndSendEnvelope({ renderedBody })`,
--   so each stage's `esign_envelopes.body_sha256` must equal it.
--   `deal_id` and `commitment_id` are the closing and its line: a closing is
--   its deal, and a line its commitment, until #3212's closings store.
--   `countersign` = 1 adds Axal's stage, last.
--
-- esign_staged_signers — the stages, in `position` order. `role` is company,
--   investor or axal. `envelope_uuid` is set when the stage is sent, and
--   `signed_at` when its envelope completes. Axal's stage names no account
--   until a Super Admin releases it (`user_id` is set then).
--
-- THE ORDER IS THE DATABASE'S, NOT ONLY THE ROUTE'S. A stage cannot be sent
-- while a stage ahead of it is unsigned, and an axal stage needs
-- `countersign` = 1 and must be the last position. A stage's sending and
-- signing are each written once.
--
-- NOTHING SECRET IS STORED. No token, no email and no signature image: the
-- token lives on `esign_recipients`, as for every envelope.
--
-- Grep first (D689 D-t): no `esign_staged_envelopes` or `esign_staged_signers`
-- table exists in schema_baseline.sql or an earlier migration. Nothing is added
-- to `users` (D1's 100-column cap) or to any existing table.
--
-- STANDS ALONE under the runner: no BEGIN/COMMIT outside trigger bodies.

CREATE TABLE IF NOT EXISTS esign_staged_envelopes (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  uid            TEXT NOT NULL UNIQUE DEFAULT (lower(hex(randomblob(16)))),
  deal_id        INTEGER NOT NULL,
  commitment_id  INTEGER,
  document_type  TEXT NOT NULL,
  title          TEXT NOT NULL,
  body           TEXT NOT NULL,
  digest         TEXT NOT NULL CHECK (length(digest) = 64),
  countersign    INTEGER NOT NULL DEFAULT 0 CHECK (countersign IN (0, 1)),
  created_by     INTEGER NOT NULL,
  voided_at      TEXT,
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_esign_staged_line ON esign_staged_envelopes(deal_id, commitment_id);

-- The text every stage signs never changes; only a void is ever written.
CREATE TRIGGER IF NOT EXISTS esign_staged_envelopes_fixed
BEFORE UPDATE ON esign_staged_envelopes
WHEN NEW.uid IS NOT OLD.uid OR NEW.deal_id IS NOT OLD.deal_id OR NEW.commitment_id IS NOT OLD.commitment_id
  OR NEW.document_type IS NOT OLD.document_type OR NEW.title IS NOT OLD.title OR NEW.body IS NOT OLD.body
  OR NEW.digest IS NOT OLD.digest OR NEW.countersign IS NOT OLD.countersign OR NEW.created_by IS NOT OLD.created_by
  OR NEW.created_at IS NOT OLD.created_at OR OLD.voided_at IS NOT NULL
BEGIN
    SELECT RAISE(ABORT, 'esign_staged_envelopes: only voided_at may be set, once (D1216).');
END;

CREATE TABLE IF NOT EXISTS esign_staged_signers (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  staged_id      INTEGER NOT NULL REFERENCES esign_staged_envelopes(id),
  position       INTEGER NOT NULL CHECK (position >= 1),
  role           TEXT NOT NULL CHECK (role IN ('company', 'investor', 'axal')),
  user_id        INTEGER,
  name           TEXT,
  envelope_uuid  TEXT UNIQUE,
  sent_at        TEXT,
  signed_at      TEXT,
  UNIQUE (staged_id, position)
);

-- Axal's stage exists only when the envelope asks for a countersign.
CREATE TRIGGER IF NOT EXISTS esign_staged_signers_axal_needs_countersign
BEFORE INSERT ON esign_staged_signers
WHEN NEW.role = 'axal'
 AND (SELECT countersign FROM esign_staged_envelopes WHERE id = NEW.staged_id) IS NOT 1
BEGIN
    SELECT RAISE(ABORT, 'esign_staged_signers: an axal stage needs countersign = 1 (D1216).');
END;

-- Nothing is added after Axal's stage: it signs last.
CREATE TRIGGER IF NOT EXISTS esign_staged_signers_axal_last
BEFORE INSERT ON esign_staged_signers
WHEN EXISTS (SELECT 1 FROM esign_staged_signers s WHERE s.staged_id = NEW.staged_id AND s.role = 'axal')
BEGIN
    SELECT RAISE(ABORT, 'esign_staged_signers: the axal stage is the last one (D1216).');
END;

-- A stage is sent only when every stage ahead of it has signed.
CREATE TRIGGER IF NOT EXISTS esign_staged_signers_in_order
BEFORE UPDATE OF envelope_uuid ON esign_staged_signers
WHEN NEW.envelope_uuid IS NOT NULL
 AND EXISTS (SELECT 1 FROM esign_staged_signers s
              WHERE s.staged_id = NEW.staged_id AND s.position < NEW.position AND s.signed_at IS NULL)
BEGIN
    SELECT RAISE(ABORT, 'esign_staged_signers: a stage is sent only after every stage ahead of it signs (D1216).');
END;

-- Sending and signing are each written once; who and where never change.
CREATE TRIGGER IF NOT EXISTS esign_staged_signers_once
BEFORE UPDATE ON esign_staged_signers
WHEN NEW.staged_id IS NOT OLD.staged_id OR NEW.position IS NOT OLD.position OR NEW.role IS NOT OLD.role
  OR (OLD.envelope_uuid IS NOT NULL AND NEW.envelope_uuid IS NOT OLD.envelope_uuid)
  OR (OLD.signed_at IS NOT NULL AND NEW.signed_at IS NOT OLD.signed_at)
  OR (OLD.user_id IS NOT NULL AND NEW.user_id IS NOT OLD.user_id)
BEGIN
    SELECT RAISE(ABORT, 'esign_staged_signers: a stage is sent once and signed once (D1216).');
END;
