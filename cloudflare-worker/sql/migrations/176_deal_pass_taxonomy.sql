-- 176 — Deal Flow: a pass is a recorded decision, not an absent row.
--
-- Before this migration a deal could enter the pipeline but the fund could
-- never record that it said no. `deals.status` has a terminal 'rejected'
-- value, but nothing wrote it except an unvalidated `PUT /api/deals/:id`
-- body, and no reason was captured anywhere. So "why did we pass on this?"
-- had no answer in the database — the fund's most re-read decision was the
-- one it did not keep.
--
-- The reason is a CHECKed enum rather than free text on purpose. Pass data is
-- only worth recording if it is queryable a year later: revisiting a
-- valuation pass when the price corrects is the entire point. Free text does
-- not aggregate, and an "other" escape hatch collects everything, so there
-- isn't one — `pass_note` carries the specifics instead.
--
-- Legacy rows already sitting at status='rejected' are deliberately NOT
-- backfilled with a guessed reason. They surface as an explicit "Reason not
-- recorded" bucket in the analytics; inventing a taxonomy value for a
-- decision nobody wrote down would corrupt the exact dataset this exists to
-- make trustworthy.

ALTER TABLE deals ADD COLUMN pass_reason TEXT
  CHECK (pass_reason IS NULL OR pass_reason IN (
    'early', 'valuation', 'thesis', 'team', 'competitive'
  ));
ALTER TABLE deals ADD COLUMN pass_note TEXT;
ALTER TABLE deals ADD COLUMN passed_at TEXT;
ALTER TABLE deals ADD COLUMN passed_by_user_id INTEGER REFERENCES users(id);

CREATE INDEX IF NOT EXISTS idx_deals_pass_reason ON deals(pass_reason, passed_at DESC);

-- Append-only stage history.
--
-- `deals.stage_changed_at` records only the CURRENT stage's entry time, so
-- the funnel could count a board snapshot but never answer "of the deals that
-- entered screening this quarter, how many advanced?" — the number an
-- investment committee actually reviews. One row per transition makes that a
-- query instead of a guess.
--
-- Rows are written going forward only. There is no way to reconstruct the
-- transitions that happened before this table existed, so the analytics
-- endpoint reports when recording began rather than presenting a partial
-- history as if it were complete.
CREATE TABLE IF NOT EXISTS deal_stage_events (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  deal_id       INTEGER NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  -- NULL from_stage marks the deal's first recorded observation, which is not
  -- necessarily its creation — a deal that predates this table gets its first
  -- event on its next move, from whatever stage it was already sitting in.
  from_stage    TEXT,
  to_stage      TEXT NOT NULL,
  -- 'advance' | 'pass' | 'set' — 'set' is a direct status write, which is a
  -- different act from walking the pipeline and is worth telling apart when
  -- reading the trail back.
  kind          TEXT NOT NULL DEFAULT 'set'
                CHECK (kind IN ('advance', 'pass', 'set')),
  -- Days the deal spent in from_stage, computed at write time from
  -- stage_changed_at. Stored rather than derived because the source column is
  -- overwritten by the very update that creates this row.
  days_in_from  INTEGER,
  actor_user_id INTEGER REFERENCES users(id),
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_deal_stage_events_deal
  ON deal_stage_events(deal_id, created_at);
CREATE INDEX IF NOT EXISTS idx_deal_stage_events_to
  ON deal_stage_events(to_stage, created_at);
