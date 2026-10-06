-- 409 — D572 part 3b (#1183): where a payout is sent, and the leaderboard's
-- earlier standings.
--
-- WHERE A PAYOUT IS SENT (the owner's Q1 = A). A partner names the
-- destination only as they would recognise it: a label ("Main business
-- account", "Ledger wallet") and the last 4 characters of the account or
-- wallet. The full details stay with the processor, out of band, so nothing
-- that could move money is stored in D1. Both are optional on a request and
-- set together; a payout requested before this reads "Not recorded".
--   destination_label  at most 60 characters, checked by the route
--   destination_last4  exactly 4 letters or digits, checked by the route
--
-- THE LEADERBOARD'S EARLIER STANDINGS. `/partnernet/leaderboard/board` ranks
-- by a metric over a period, and its "change" is the move against a stored
-- earlier standing. `partner_leaderboard_snapshots` is one row per day,
-- metric, period and member, written once a day by the cron
-- (`writeLeaderboardSnapshots`). Re-running a day writes nothing new: the
-- primary key ignores a second write. Only members with a value above zero
-- are ranked, so a member absent from a snapshot was not on the board then.
--   snapshot_date  YYYY-MM-DD, UTC
--   metric         score | referrals | commissions
--   period_key     'all', or a quarter such as '2026-Q4'
--   value          the measure on that day
--   rank           1-based; equal values share a rank
--
-- No BEGIN/COMMIT: D1 rejects transaction statements in a migration (#26).

ALTER TABLE payouts ADD COLUMN destination_label TEXT;
ALTER TABLE payouts ADD COLUMN destination_last4 TEXT;

CREATE TABLE IF NOT EXISTS partner_leaderboard_snapshots (
    snapshot_date  TEXT NOT NULL,
    metric         TEXT NOT NULL CHECK (metric IN ('score', 'referrals', 'commissions')),
    period_key     TEXT NOT NULL,
    user_id        INTEGER NOT NULL,
    value          INTEGER NOT NULL,
    rank           INTEGER NOT NULL CHECK (rank >= 1),
    created_at     TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (snapshot_date, metric, period_key, user_id)
);
CREATE INDEX IF NOT EXISTS idx_partner_lb_snap_lookup
    ON partner_leaderboard_snapshots(metric, period_key, snapshot_date);
