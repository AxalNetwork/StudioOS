-- Migration 295 — the licence pushes HQ still owes a branch (task 431 / D272).
--
-- `pushLicenceToBranch` (services/licencePush.ts) reported a failed push and
-- stopped: nothing re-sent it. A branch that already holds a copy never pulls
-- (routes/licence.ts pulls only when it holds none), so a push that failed —
-- no BRANCH_<CODE> binding yet, the branch unreachable, a refusal — left that
-- branch on its old licence until some later transition happened to push.
--
-- One row per licence whose last push to its deployed branch did not land.
-- A push that lands deletes the row, so a branch holding the current copy is
-- never re-sent it. HQ's scheduled handler retries a row at most once per
-- window (retryPendingLicencePushes). A licence with no deployment gets no
-- row: there is nothing to push to, and the branch pulls on its first read.
CREATE TABLE IF NOT EXISTS licence_push_pending (
  licence_id      INTEGER PRIMARY KEY REFERENCES territory_licences(id),
  code            TEXT    NOT NULL,
  reason          TEXT,
  attempts        INTEGER NOT NULL DEFAULT 1,
  first_failed_at TEXT    NOT NULL,
  last_attempt_at TEXT    NOT NULL
);
