-- D4671 (#4671) — a licence contract carries the fingerprint of the text it
-- holds, and a licence has exactly one current contract.
--
-- body_sha256: SHA-256 (hex) of `body_md` as stored, written when the contract
-- is instantiated and checked again when it is sent. The e-sign envelope hashes
-- the body it is given (D416), so the stored hash, the envelope's `body_sha256`
-- and the hash the signer's PDF carries are one value. NULL on a row written
-- before this migration: such a row is hashed from its stored body at send
-- time, which pins what is sent to what is stored from then on.
--
-- THE UNIQUE INDEX is "exactly one current contract per licence". Instantiation
-- supersedes the old row and inserts the new one in one batch; this index is
-- what stops two concurrent instantiations leaving two current rows. Rows are
-- never deleted: the backfill below only marks the older of any duplicate
-- current rows superseded, which is what the application would have done.

ALTER TABLE licence_contracts ADD COLUMN body_sha256 TEXT;

UPDATE licence_contracts
   SET superseded_at = COALESCE(updated_at, created_at), updated_at = COALESCE(updated_at, created_at)
 WHERE superseded_at IS NULL
   AND id < (SELECT MAX(c2.id) FROM licence_contracts c2
              WHERE c2.licence_uid = licence_contracts.licence_uid AND c2.superseded_at IS NULL);

CREATE UNIQUE INDEX IF NOT EXISTS idx_licence_contracts_one_current
  ON licence_contracts (licence_uid) WHERE superseded_at IS NULL;
