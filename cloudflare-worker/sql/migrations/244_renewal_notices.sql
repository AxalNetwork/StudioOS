-- Task #163 — the record of which renewal warnings have already been sent.
--
-- WHY A TABLE AND NOT A QUERY OVER THE INBOX. The sweep runs nightly, so
-- something has to remember "we already told this person about this item at
-- this distance" or they get the same warning every night until it lapses.
-- `notifications_inbox` cannot be that memory: a reader can mark rows read
-- and the UI can clear them, and its `payload` is opaque JSON with no index
-- to match on. A claim table is the memory, and the INSERT is the decision:
-- `INSERT OR IGNORE` succeeds exactly once per (person, item, threshold,
-- deadline), so two overlapping runs cannot double-send. Same pattern as
-- migration 243's score snapshot, for the same reason.
--
-- WHY `user_id` IS IN THE KEY. A pairwise NDA has TWO parties and both must
-- be warned. Keyed on the subject alone, the first party's claim would
-- silently swallow the second party's warning — caught by reading
-- `expireDueArtifacts`, which flips one NDA row that two people depend on.
--
-- WHY `expires_at` IS IN THE KEY. When an obligation is renewed its deadline
-- becomes a different value, so the three warnings arm again for the new
-- term. Without it an item warned once could never be warned again for the
-- rest of its life, which is the opposite of what a renewal notice is for.
--
-- No BEGIN/COMMIT — D1 rejects transaction statements in a migration file
-- (migration 200 shipped with them once and could not be applied).

CREATE TABLE IF NOT EXISTS renewal_notices (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id        INTEGER NOT NULL,
  subject_kind   TEXT    NOT NULL,
  subject_id     INTEGER NOT NULL,
  threshold_days INTEGER NOT NULL,
  expires_at     TEXT    NOT NULL,
  notified_at    TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_renewal_notices_once
  ON renewal_notices(user_id, subject_kind, subject_id, threshold_days, expires_at);

-- Reading back "what have we told this person lately" for support/debugging.
CREATE INDEX IF NOT EXISTS idx_renewal_notices_user
  ON renewal_notices(user_id, notified_at DESC);
