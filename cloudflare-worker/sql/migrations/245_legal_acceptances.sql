-- The record that somebody actually agreed.
--
-- WHY A SEPARATE TABLE FROM `legal_obligations`. That table carries
-- `UNIQUE(user_id, obligation_key)` and is mutable by design: the role-prune
-- waives rows, the expiry sweep flips them, and a renewal overwrites the same
-- row. It answers "is this person compliant right now", which is the wrong
-- question for a consent record. When the terms change, the evidence that
-- someone accepted v1 has to survive the row moving on to v2, and a table with
-- one row per person per key cannot hold two acceptances. So this is
-- append-only: one row per act, never updated, never deleted. `legal_obligations`
-- keeps the current status and points at nothing; this keeps the history.
--
-- WHY THIS EXISTS AT ALL. Until now nothing recorded acceptance anywhere:
-- `/register` showed passive "By continuing you agree" text in 10px under the
-- submit button, the onboarding licence gate showed only two link labels and no
-- such sentence, and the claim that continuing constituted acceptance lived in
-- code comments rather than on screen. `tos_v1` and `privacy_v1` were therefore
-- seeded `pending` for every account and nothing could ever satisfy them
-- (`test/obligation_satisfiable.test.ts`). The fix is a real checkbox, and a
-- checkbox with nowhere to write is not evidence — hence this table.
--
-- NO DOCUMENT HASH, DELIBERATELY. The obvious column here is a sha256 of the
-- text the person was shown, and it is omitted because it could not be honest
-- today: `/terms` and `/privacy` render hardcoded JSX in
-- `frontend/src/pages/TermsPage.jsx` and `PrivacyPage.jsx`, while the
-- `tos_v1`/`privacy_v1` templates under `cloudflare-worker/src/templates/legal/`
-- are a different document with different wording and, in the case of their
-- effective dates, different content. Hashing the template would record
-- something the reader never saw, which is worse evidence than none. Making the
-- page and the template one document is separate work; when it is done, add the
-- column then. A column with no honest writer is how this schema ended up with
-- `corporate_profiles.kyb_status`.
--
-- The version is carried by `obligation_key` itself (`tos_v1`), which is the
-- only version marker the system has. There is no current-terms constant
-- anywhere; a real v2 needs a new key plus a seeding change, not a column here.
--
-- `surface` says where the act happened, so a later audit can tell a signup
-- checkbox from a re-acceptance interstitial from an admin backfill without
-- guessing. `ip`/`ua` mirror what `esign_recipients` already records for a
-- signature, for the same reason and with the same expectations.

CREATE TABLE IF NOT EXISTS legal_acceptances (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  obligation_key TEXT NOT NULL,                  -- 'tos_v1' | 'privacy_v1'
  accepted_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  surface TEXT NOT NULL,                         -- e.g. 'onboarding_licence'
  ip TEXT,
  ua TEXT
);

-- The read this table has: "has this person accepted this key, and when".
CREATE INDEX IF NOT EXISTS idx_legal_acceptances_user_key
  ON legal_acceptances (user_id, obligation_key, accepted_at);
