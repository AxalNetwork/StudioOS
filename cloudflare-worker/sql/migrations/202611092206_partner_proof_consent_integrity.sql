-- 202611092206_partner_proof_consent_integrity.sql — D4672 (#4672): a firm's
-- proof is confirmed by the client named, about the claim exactly as it read,
-- and a withdrawal stays withdrawn. Additive: columns on the two 209 tables and
-- two new tables. The model is D4670's for advisors (202611062216), applied to
-- Offers · Proof.
--
-- 1. `partner_proof_items.revision` / `claim_sha256`: the item's current
--    revision number and the SHA-256 of its claim (kind, title, detail,
--    outcome, engagement). A material edit moves both. Kept on the row so a
--    SQL reader (research.ts) can tell a live consent from a superseded one
--    without hashing. NULL on a row written before this file: the Worker fills
--    it on that item's next write or request.
-- 2. `partner_proof_consents.claim_sha256` / `claim_json` / `revision`: the
--    claim exactly as it read when confirmation was asked for. A confirmation
--    counts only while the item still reads that way; an edit leaves it
--    attached to the revision it was about. A row recorded before this file
--    has none, so its answer is kept and shown and no longer counts (the same
--    call the owner made for advisors on #4670).
--    `expires_at`: the link stops answering after it. `closed_at`: a declined
--    or withdrawn request answers nothing again; the firm asks anew.
-- 3. `partner_proof_consent_codes`: the one-time codes that prove the person
--    answering reads the address the firm named. Only a hash of each code is
--    kept; a code lasts 15 minutes, allows 5 tries and is used once.
-- 4. `partner_proof_consent_events`: every ask and answer, append-only (two
--    triggers), and kept when an item is deleted, holding no name or address.
--
-- STANDS ALONE under the runner: no BEGIN/COMMIT.

ALTER TABLE partner_proof_items ADD COLUMN revision INTEGER NOT NULL DEFAULT 1;
ALTER TABLE partner_proof_items ADD COLUMN claim_sha256 TEXT;

ALTER TABLE partner_proof_consents ADD COLUMN claim_sha256 TEXT;
ALTER TABLE partner_proof_consents ADD COLUMN claim_json TEXT;
ALTER TABLE partner_proof_consents ADD COLUMN revision INTEGER;
ALTER TABLE partner_proof_consents ADD COLUMN expires_at TEXT;
ALTER TABLE partner_proof_consents ADD COLUMN closed_at TEXT;

CREATE TABLE IF NOT EXISTS partner_proof_consent_codes (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  consent_id  INTEGER NOT NULL REFERENCES partner_proof_consents(id),
  code_hash   TEXT NOT NULL,
  expires_at  TEXT NOT NULL,
  attempts    INTEGER NOT NULL DEFAULT 0,
  used_at     TEXT,
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_partner_proof_consent_codes_consent
  ON partner_proof_consent_codes(consent_id, created_at);

CREATE TABLE IF NOT EXISTS partner_proof_consent_events (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  -- No REFERENCES: the history outlives an item its firm deletes.
  consent_id    INTEGER NOT NULL,
  kind          TEXT NOT NULL CHECK (kind IN ('asked', 'confirmed', 'declined', 'withdrawn', 'superseded')),
  revision      INTEGER,
  claim_sha256  TEXT,
  created_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_partner_proof_consent_events_consent
  ON partner_proof_consent_events(consent_id, id);

CREATE TRIGGER IF NOT EXISTS partner_proof_consent_events_block_update
BEFORE UPDATE ON partner_proof_consent_events
BEGIN
    SELECT RAISE(ABORT, 'partner_proof_consent_events is append-only (D4672).');
END;

CREATE TRIGGER IF NOT EXISTS partner_proof_consent_events_block_delete
BEFORE DELETE ON partner_proof_consent_events
BEGIN
    SELECT RAISE(ABORT, 'partner_proof_consent_events is append-only (D4672).');
END;
