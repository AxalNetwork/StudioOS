-- 625 — Venture scorecard part 2 (D1255, #3278): the state of a stored scope.
-- Assigned to #3278 on the issue (D1253 §6).
--
-- WHY SO SMALL. The tables #3278 names already exist: migration 598 (D1144)
-- created `scoring_model_versions` and `venture_scorecards` as SCORING's shared
-- store, keyed by (scope, version), with Product-market fit as its first
-- scope. The ten other scopes write the same rows, so this migration adds only
-- what they need and 598 lacks.
--
-- state — 'scored', 'not_enough' or 'not_expected'. A row with no value is
--   either "Not enough recorded" or "Not expected yet" (Traction and Financial
--   before Build, owner question 11). Both store value and band NULL, so the
--   word cannot be read back from them; part 3's batch read for the scope strip
--   needs it without parsing `inputs_json`. NULL on D1144's PMF rows, which
--   read their state from their own payload. An unreadable scope is never
--   stored, so it has no state here.
--
-- Grep first (D689 D-t): no `state` column on venture_scorecards in 598 or
-- later. Nothing is added to `users` or to any other table.
--
-- STANDS ALONE under the runner: no BEGIN/COMMIT. Not re-runnable; the
-- migration ledger stops the replay.

ALTER TABLE venture_scorecards ADD COLUMN state TEXT
  CHECK (state IS NULL OR state IN ('scored', 'not_enough', 'not_expected'));
