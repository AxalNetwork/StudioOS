-- D4695 (#4695): an engagement's renewal history, kept as events.
--
-- `advisor_engagements.cycles`, `outcome` and `renewal_note` hold only the
-- latest state: replaying a renewal moved the count twice, and nothing recorded
-- that a term had been decided, by what, or when. This is the append-only
-- record beside them. A row is written in the same batch as the UPDATE it
-- describes and is never changed.
--
--   kind          'signed'   the engagement entered a signed lane (cycle 1 begins)
--                 'renewed'  the term that just ran was renewed (cycles + 1)
--                 'ended'    the term that just ran was not renewed
--   cycles_before the cycle count the decision was taken on
--   cycles_after  the count after it (renewed adds one; the others leave it)
--
-- TWO UNIQUE INDEXES ARE THE IDEMPOTENCY. A term can be decided once
-- (`engagement_id`, `cycles_before` for 'renewed'/'ended'), and an engagement
-- is signed once. A repeated command meets the index and changes nothing, so a
-- retry after a timeout cannot count a cycle twice. Rows from before this
-- migration have no events; nothing is backfilled for a decision nobody
-- recorded.

CREATE TABLE IF NOT EXISTS advisor_engagement_events (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  uid           TEXT NOT NULL UNIQUE,
  engagement_id INTEGER NOT NULL,
  kind          TEXT NOT NULL CHECK (kind IN ('signed', 'renewed', 'ended')),
  from_lane     TEXT,
  to_lane       TEXT,
  cycles_before INTEGER NOT NULL CHECK (cycles_before >= 0),
  cycles_after  INTEGER NOT NULL CHECK (cycles_after >= 0),
  note          TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_advisor_engagement_events_term
  ON advisor_engagement_events (engagement_id, cycles_before) WHERE kind IN ('renewed', 'ended');
CREATE UNIQUE INDEX IF NOT EXISTS idx_advisor_engagement_events_signed
  ON advisor_engagement_events (engagement_id) WHERE kind = 'signed';
CREATE INDEX IF NOT EXISTS idx_advisor_engagement_events_by_engagement
  ON advisor_engagement_events (engagement_id, id);
