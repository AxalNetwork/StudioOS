-- D4692 (#4692): who decided a booking or engagement change, and when.
--
-- ONE APPEND-ONLY LEDGER for the consequential lifecycle decisions of the
-- Practice zone: a booking confirmed, completed, cancelled or marked a no-show;
-- an engagement signed, moved, ended, or given its renewal outcome. A row is
-- written in the SAME batch as the conditional UPDATE it describes and only
-- when that UPDATE changed a row (`WHERE changes() > 0`), so a stale write that
-- lost the race leaves no event and a winning write cannot lack one.
--
-- A new table, so no existing CHECK is rebuilt and no applied migration is
-- touched. `actor_user_id` is NULL only for a change the platform made on its
-- own behalf (a slot the advisor cancelled cancelling its open bookings is
-- still attributed to that advisor). No transaction statements (D1 rejects
-- them).

CREATE TABLE IF NOT EXISTS advisor_lifecycle_events (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  subject_kind   TEXT    NOT NULL CHECK (subject_kind IN ('booking', 'engagement')),
  subject_id     INTEGER NOT NULL,
  advisor_id     INTEGER NOT NULL,
  from_state     TEXT    NOT NULL,
  to_state       TEXT    NOT NULL,
  -- The renewal decision ('renewed' / 'ended') when the event is one; else NULL.
  decision       TEXT,
  actor_user_id  INTEGER,
  actor_role     TEXT    NOT NULL,
  reason         TEXT,
  created_at     TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_advisor_lifecycle_events_subject
  ON advisor_lifecycle_events (subject_kind, subject_id, id);
