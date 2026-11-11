-- D4715 (#4715) — a correction to a signed engagement's terms, recorded.
--
-- `PATCH /me/engagements/:id` rewrote scope, price, shape and term end in
-- place whatever the lane, so the terms of a signed contract could change
-- with nothing saying they had, when, or why. An unsigned draft is still
-- edited freely; once an engagement has been signed (`started_at` set), a
-- change to its terms needs a reason and writes one row here, in the same
-- batch as the update, holding each changed field's value before and after.
-- Rows are append-only: nothing updates or deletes them.
CREATE TABLE IF NOT EXISTS advisor_engagement_corrections (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  uid                TEXT NOT NULL UNIQUE,
  engagement_id      INTEGER NOT NULL REFERENCES advisor_engagements(id),
  lane               TEXT NOT NULL,
  reason             TEXT NOT NULL CHECK (length(trim(reason)) > 0),
  changes_json       TEXT NOT NULL,
  corrected_by_user_id INTEGER NOT NULL,
  created_at         TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_advisor_engagement_corrections_by_engagement
  ON advisor_engagement_corrections (engagement_id, id);
