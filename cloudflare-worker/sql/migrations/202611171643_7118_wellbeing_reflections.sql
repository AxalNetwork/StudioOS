-- D7118 (#7118): Wellness reflections. One row per member, cadence and
-- period: a day, a week (Monday to Sunday) or a calendar month, each a date
-- in the member's own calendar. A daily save never touches a weekly or a
-- monthly row, and the reverse.
--
-- Every answer is AES-GCM ciphertext (services/cryptoBox.ts). There are no
-- plaintext backstop columns: when the cipher is unavailable the route
-- refuses and the member's draft stays on their screen (D7118).
--
-- `revision` and `last_request_id` make a retry safe and an edit made from a
-- stale copy a refusal, never a silent overwrite.
--
-- `wellbeing_daily_pulses` is untouched: its rows keep their own dates and
-- are read as "earlier check-ins", never re-filed as a day or a week.

CREATE TABLE IF NOT EXISTS wellbeing_reflections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  user_id INTEGER NOT NULL,
  cadence TEXT NOT NULL CHECK (cadence IN ('day', 'week', 'month')),
  period_start TEXT NOT NULL,
  period_end TEXT NOT NULL,
  timezone TEXT NOT NULL,
  scores_enc TEXT,
  text_enc TEXT,
  topics_enc TEXT,
  revision INTEGER NOT NULL DEFAULT 1,
  last_request_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (user_id, cadence, period_start)
);

CREATE INDEX IF NOT EXISTS idx_wellbeing_reflections_user_period
  ON wellbeing_reflections (user_id, cadence, period_start DESC);

CREATE INDEX IF NOT EXISTS idx_wellbeing_reflections_updated
  ON wellbeing_reflections (updated_at);
