-- #4713 (Practice audit 4/6, D4713): a session's price change is an audited
-- operation, and a status-only change never restates it.
--
-- `advisor_bookings` already snapshots `amount_cents`, `take_rate_bps` and
-- `platform_cut_cents` when a session is priced (241). Before #4713 the billing
-- PATCH re-read the platform's current take rate on EVERY write, so marking a
-- $100 session collected after the setting moved from 15% to 12% rewrote its
-- history to 12% / $12. The route now keeps the stored rate and cut unless the
-- amount itself changes, and a change of amount on a priced line (a reprice) is
-- written here: who, when, and the figures before and after.
--
-- One row per reprice. Nothing here moves money; it is the record of an edit to
-- the advisor's own bookkeeping (205). `actor_user_id` is the signed-in user,
-- and `impersonated_by` the admin behind an impersonation session, if any.

CREATE TABLE IF NOT EXISTS advisor_booking_price_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  booking_id INTEGER NOT NULL REFERENCES advisor_bookings(id) ON DELETE CASCADE,
  actor_user_id INTEGER NOT NULL,
  impersonated_by INTEGER,
  from_amount_cents INTEGER,
  to_amount_cents INTEGER,
  from_take_rate_bps INTEGER,
  to_take_rate_bps INTEGER,
  from_cut_cents INTEGER,
  to_cut_cents INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_advisor_booking_price_events_booking ON advisor_booking_price_events(booking_id, id);
