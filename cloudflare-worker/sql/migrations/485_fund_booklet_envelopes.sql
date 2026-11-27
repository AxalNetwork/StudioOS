-- 485_fund_booklet_envelopes.sql — D759 (#1858): a submitted Subscription
-- Booklet sent for e-signature.
--
-- Adds one table, `fund_booklet_envelopes`: one row per signing stage of a
-- submitted booklet, linking it to the e-sign envelope that carries it.
--
--   applicant   the applicant signs Parts 3 to 8 (and Part 3's counterparty
--               line), in an envelope whose body is the booklet's frozen copy;
--   gp          the Fund's signatory signs Part 9 and Part 3's Fund line, in a
--               second envelope over the same frozen copy.
--
-- Each row carries the booklet's digest, which is also the envelope's
-- `body_sha256` (the envelope's body IS `frozen_json`), so the row records
-- that the applicant and the General Partner signed exactly what was ticked.
-- Append-only, as 478's tables are: an envelope sent for a booklet is a
-- record of what was signed.
--
-- IT CHANGES NO D716 TABLE. `fund_subscription_booklets` and its triggers are
-- untouched; the signing state is read from the envelopes this links to.
--
-- NOTHING SECRET IS STORED. No signing token, no email and no signature image:
-- the token lives on `esign_recipients` as it does for every envelope, and the
-- image only in the signed PDF.
--
-- Grepped first: no `fund_booklet_envelopes` table, and no booklet column on
-- `esign_envelopes`, exists in schema_baseline.sql or an earlier migration.
-- Seeds nothing.
--
-- STANDS ALONE under the runner: no BEGIN/COMMIT outside trigger bodies.

CREATE TABLE IF NOT EXISTS fund_booklet_envelopes (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  booklet_id     INTEGER NOT NULL REFERENCES fund_subscription_booklets(id),
  envelope_uuid  TEXT NOT NULL UNIQUE,
  stage          TEXT NOT NULL CHECK (stage IN ('applicant', 'gp')),
  digest         TEXT NOT NULL CHECK (length(digest) = 64),
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (booklet_id, stage)
);

-- A stage is recorded only for a submitted booklet, under its own digest.
CREATE TRIGGER IF NOT EXISTS fund_booklet_envelopes_submitted
BEFORE INSERT ON fund_booklet_envelopes
WHEN (SELECT status FROM fund_subscription_booklets WHERE id = NEW.booklet_id) IS NOT 'submitted'
  OR (SELECT digest FROM fund_subscription_booklets WHERE id = NEW.booklet_id) IS NOT NEW.digest
BEGIN
    SELECT RAISE(ABORT, 'fund_booklet_envelopes: only a submitted booklet is sent for signature, under its own digest (D759).');
END;

-- The General Partner accepts only after the applicant's stage exists.
CREATE TRIGGER IF NOT EXISTS fund_booklet_envelopes_gp_after_applicant
BEFORE INSERT ON fund_booklet_envelopes
WHEN NEW.stage = 'gp'
 AND NOT EXISTS (SELECT 1 FROM fund_booklet_envelopes WHERE booklet_id = NEW.booklet_id AND stage = 'applicant')
BEGIN
    SELECT RAISE(ABORT, 'fund_booklet_envelopes: the General Partner stage needs the applicant stage first (D759).');
END;

CREATE TRIGGER IF NOT EXISTS fund_booklet_envelopes_block_update
BEFORE UPDATE ON fund_booklet_envelopes
BEGIN
    SELECT RAISE(ABORT, 'fund_booklet_envelopes is append-only (D759). An envelope sent for a booklet is a record of what was signed.');
END;

CREATE TRIGGER IF NOT EXISTS fund_booklet_envelopes_block_delete
BEFORE DELETE ON fund_booklet_envelopes
BEGIN
    SELECT RAISE(ABORT, 'fund_booklet_envelopes is append-only (D759). An envelope sent for a booklet is a record of what was signed.');
END;
