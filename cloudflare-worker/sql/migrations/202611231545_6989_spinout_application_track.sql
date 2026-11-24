-- D6989 (#6989): the Spin-Out Lab starting point an applicant chose, stored with the application.
--
-- The Lab page lets a visitor pick a starting point (a "track": form, fit or line, `LAB_TRACKS` in
-- frontend/src/lib/spinoutLabArsenal.js). Until now the choice was dropped at the apply link, and the brief
-- promised a choice nothing recorded. The apply link now carries `track` through sign-up, the application
-- form preselects it, and `POST /api/spinout-lab/apply` validates it against the three known values and
-- stores it here.
--
--   spinout_applications.track — 'form' | 'fit' | 'line', or NULL when none was sent. Every application made
--     before this migration keeps NULL, and a reader shows "Not recorded" for it, never a default track.
--
-- Additive: one nullable column with a CHECK, no default. NON-IDEMPOTENT (D1's ALTER TABLE has no IF NOT
-- EXISTS): applied once by the ledger-driven runner. Rollback: revert the Worker; the column can stay.

ALTER TABLE spinout_applications ADD COLUMN track TEXT CHECK (track IS NULL OR track IN ('form', 'fit', 'line'));
