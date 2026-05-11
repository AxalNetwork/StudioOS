-- Task #38 — Idempotency table for rev-share attribution-window
-- expiry warnings.
--
-- partner_referral_redemptions for `attribution_kind =
-- 'deal_sourcing_revshare'` carry a 365-day attribution window
-- measured from `redeemed_at` (see services/partnerDeals.ts and
-- routes/partner_portal.ts). Task #26 surfaced the per-redemption
-- countdown in the portal UI; Task #38 turns the countdown into an
-- email + in-app push 30 / 7 / 1 days before each window closes.
--
-- The cron (services/partnerDeals.ts::notifyExpiringRevshareWindows)
-- writes one row per (redemption_id, threshold_days) tuple it has
-- already notified, so re-runs (multi-minute cron drift, retried
-- batches, lease handoff) never double-page a partner. The UNIQUE
-- index doubles as the dedupe primitive — we use INSERT OR IGNORE
-- and only send when meta.changes === 1.
--
-- Threshold values are integers in {30, 7, 1} but we don't constrain
-- them at the SQL layer in case product wants a 14-day step later.
-- Both columns are NOT NULL; redemption_id FK gives us cascade-aware
-- cleanup if a redemption is ever hard-deleted (it currently isn't —
-- terminate just revokes tier grants, leaving the audit row intact).

CREATE TABLE IF NOT EXISTS partner_revshare_window_notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  redemption_id INTEGER NOT NULL REFERENCES partner_referral_redemptions(id),
  threshold_days INTEGER NOT NULL,
  notified_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(redemption_id, threshold_days)
);
CREATE INDEX IF NOT EXISTS idx_prwn_redemption
  ON partner_revshare_window_notifications(redemption_id);
