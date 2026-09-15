-- 243 — one recorded trust score per user per month, so the Trust Center can
-- say how the score MOVED instead of only what it is.
--
-- WHY THIS EXISTS. `Trust Center v2.dc.html` draws a delta under the score
-- ring — "+6 since last month (was 47)". The canvas backs it with a literal:
--
--     const PREV_SCORE = { founder:47, investor:58, partner:39, admin:81 };
--
-- a fixture keyed by ROLE, which is a stand-in for data and not a design for
-- it. Nothing in this repo stored a previous score: no `trust_score_history`,
-- no snapshot column, and `/api/trust/me` computes the score fresh on every
-- read and returns only today's number. Shipping the delta without a store
-- would have meant inventing a past.
--
-- THE CANVAS'S FALLBACK IS THE TRAP, not the fixture. When a role is missing
-- from PREV_SCORE it does `prevScore = score`, which renders "Unchanged from
-- last month." A brand-new account would then be told its score held steady
-- across a month it did not exist for — a plausible zero of exactly the kind
-- D56/D68 forbids. An account with no prior month has NO delta, and the page
-- says so rather than showing a comforting one.
--
-- ONE ROW PER USER PER CALENDAR MONTH. `captured_month` is a calendar LABEL
-- ('2026-09'), not an instant, for the same reason `advisor_period_notes`
-- (242) keys on '2026-Q3': the question "what was my score last month" is
-- asked in the reader's own reckoning of months, and a timestamp range would
-- let two snapshots land in one month with no way to say which was meant.
-- `captured_at` keeps the instant alongside it, because when in the month the
-- reading was taken is a real fact and the label alone loses it — the same
-- label/instant pairing 241 draws between a scheduled payout day and the
-- moment it settled.
--
-- WHY NOT A CRON. A snapshot is written when a user READS their Trust Center,
-- at most once per month per user, via INSERT OR IGNORE against the UNIQUE
-- index below. That means the history covers exactly the people who look at
-- it, which is the population the delta is shown to, and it costs no
-- scheduled worker. A user who skips a month simply has no row for it, and a
-- gap is visible rather than interpolated: the route compares against the
-- most recent EARLIER month it actually has, and names which month that was.
--
-- NO BEGIN/COMMIT — D1 rejects transaction statements in a migration.

CREATE TABLE IF NOT EXISTS trust_score_snapshots (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id        INTEGER NOT NULL,
  -- '2026-09'. A calendar label; never parsed into a Date, never compared
  -- with captured_at. Lexicographic order IS chronological order for this
  -- format, which is what lets "the most recent earlier month" be a plain
  -- string comparison instead of date arithmetic.
  captured_month TEXT    NOT NULL,
  -- 0..100, the same integer `computeTrustScore` renders. Stored rather than
  -- recomputed because the obligation matrix behind it changes: re-deriving
  -- last month's score from today's obligations would answer a different
  -- question and always report no change.
  score          INTEGER NOT NULL CHECK (score >= 0 AND score <= 100),
  captured_at    TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- The pair is what makes the write idempotent: the first read in a month
-- records the score, every later read that month is an INSERT OR IGNORE
-- no-op, and the row keeps the score as it stood when the month was first
-- observed.
CREATE UNIQUE INDEX IF NOT EXISTS idx_trust_score_snapshots_month
  ON trust_score_snapshots(user_id, captured_month);

-- Reading "my most recent month before X" is the only query this table
-- serves, and it is per-user and ordered by the label.
CREATE INDEX IF NOT EXISTS idx_trust_score_snapshots_user
  ON trust_score_snapshots(user_id, captured_month DESC);
