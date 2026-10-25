-- 583 — Trust center part 2: which version of a document was accepted
-- (D1074, #2966; finding 7 of #2425's trust map).
--
-- `legal_acceptances` (migration 245) records that someone accepted a key
-- (`tos_v1`, `privacy_v1`), when and where, but not which text: the key has
-- stayed `tos_v1` while the Terms page changed. `document_version` is the
-- page's own "Last updated" date, as `YYYY-MM-DD`, written by
-- `recordTermsAcceptance` from `LEGAL_DOCUMENT_VERSIONS`
-- (`cloudflare-worker/src/services/trust.ts`), which a test holds equal to
-- `TERMS_UPDATED` and `PRIVACY_UPDATED` on the pages themselves.
--
-- NULLABLE, AND NEVER BACKFILLED. A row written before this column existed
-- does not say which text was shown, and guessing would record something
-- nobody saw. `/api/trust/me` answers such a row's version as not recorded.
--
-- The table stays append-only: one row per act, never updated.

ALTER TABLE legal_acceptances ADD COLUMN document_version TEXT;
