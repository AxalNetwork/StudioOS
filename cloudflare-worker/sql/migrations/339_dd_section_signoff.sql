-- 339_dd_section_signoff.sql — who signed a DD section off (D466, wave 8,
-- Session 17, item 7).
--
-- The Due Diligence canvas's report draws a Sign-off column per section —
-- who returned the verdict and when. The signer was derivable from
-- `dd_reviewers.responded_at` when an ASSIGNED reviewer returned it, but an
-- admin override (a verdict with no reviewer row) recorded no signer at all.
-- `signed_off_by` is stamped on every verdict write, reviewer or admin, so
-- the two paths record alike. `completed_at` already carries the when.
--
-- STANDS ALONE and additive. NON-IDEMPOTENT (D1's ALTER TABLE has no IF NOT
-- EXISTS) — apply through the ledger-driven runner, which runs it once:
--
--   npm run d1:migrate:remote

ALTER TABLE dd_sections ADD COLUMN signed_off_by INTEGER REFERENCES users(id);
