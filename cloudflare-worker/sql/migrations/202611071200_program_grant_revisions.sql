-- D4805 (#4805, Programs audit 2/7) — a signature proves a specific terms revision.
--
-- Two columns on program_grants and three new tables; no existing column changes:
--
--   program_grants.signed_revision      The newest revision whose schedule was signed; never cleared.
--   program_grants.terms_revision       Starts at 1 and goes up by one with every accepted change to the
--                                       grant's terms or its note (the two things the schedule prints), and
--                                       with a re-grant. A write names the revision it read, so a stale
--                                       change loses.
--   program_grant_schedules             One row per schedule envelope: the revision and the terms hash it
--                                       was built for, when it was sent and when (if ever) it was signed,
--                                       and when a newer revision replaced it. The row is never deleted and
--                                       its signature is never cleared, so the record of what the studio
--                                       signed outlives a later change of terms. An envelope can mark a
--                                       grant signed only if its row names the grant's current revision and
--                                       hash (`onProgramScheduleEnvelopeCompleted`).
--   decision_guard                      An empty table whose one column must be 1. A batch inserts
--                                       `changes() = 1` into it straight after its deciding statement; when
--                                       that statement lost, the insert fails the CHECK and D1 rolls the
--                                       whole batch back, so every statement after the guard runs only for
--                                       the winner. Rows are deleted in the same batch.
--   program_outbox                      A notice (or other post-commit delivery) written in the same batch
--                                       as the decision it announces. Delivered after the commit and
--                                       retried from here, never by repeating the decision.
--
-- Grants that already name a schedule envelope get a row for it at revision 1; the hash is 'legacy', which
-- the completion check treats as "revision only", because the terms those envelopes were built from were
-- not hashed when they were sent.

ALTER TABLE program_grants ADD COLUMN terms_revision INTEGER NOT NULL DEFAULT 1;
-- The newest revision whose schedule the studio has signed. It is never cleared: when the terms move on
-- (terms_revision goes past it) the grant reads "amendment needed", not "never signed".
ALTER TABLE program_grants ADD COLUMN signed_revision INTEGER;
UPDATE program_grants SET signed_revision = 1 WHERE schedule_signed_at IS NOT NULL;

CREATE TABLE IF NOT EXISTS program_grant_schedules (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  grant_id       INTEGER NOT NULL REFERENCES program_grants(id) ON DELETE CASCADE,
  revision       INTEGER NOT NULL CHECK (revision >= 1),
  terms_hash     TEXT    NOT NULL,
  envelope_uuid  TEXT    NOT NULL UNIQUE,
  sent_at        TEXT    NOT NULL,
  signed_at      TEXT,
  superseded_at  TEXT
);
CREATE INDEX IF NOT EXISTS idx_program_grant_schedules_grant ON program_grant_schedules(grant_id, revision);

INSERT OR IGNORE INTO program_grant_schedules (grant_id, revision, terms_hash, envelope_uuid, sent_at, signed_at)
SELECT id, 1, 'legacy', schedule_contract_uid, COALESCE(schedule_signed_at, set_at), schedule_signed_at
  FROM program_grants WHERE schedule_contract_uid IS NOT NULL;

CREATE TABLE IF NOT EXISTS decision_guard (
  decision_won INTEGER NOT NULL CHECK (decision_won = 1)
);

CREATE TABLE IF NOT EXISTS program_outbox (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  kind          TEXT    NOT NULL CHECK (kind IN ('notice')),
  user_id       INTEGER REFERENCES users(id) ON DELETE CASCADE,
  payload_json  TEXT    NOT NULL,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  attempts      INTEGER NOT NULL DEFAULT 0,
  last_attempt_at TEXT,
  delivered_at  TEXT
);
CREATE INDEX IF NOT EXISTS idx_program_outbox_pending ON program_outbox(delivered_at, id);
