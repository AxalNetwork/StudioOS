-- 361_partner_booking_ratings.sql — Office Hours: a founder's rating of a
-- completed partner session (D355, wave 8, Session 7, deferred list).
--
-- The Office Hours canvas shows a star rating on every partner card. Nothing
-- stored a rating, so the page omitted it.
--
-- Owner decisions (relayed 2026-09-27):
--   * a partner's average is ALWAYS shown, with the count beside it — from the
--     first rating;
--   * the partner sees the rating on each of their own sessions.
-- Rules the Worker enforces (services/partnerBookingFollowups.ts):
--   * only the booking's founder rates, only a COMPLETED booking, 1–5;
--   * one rating per booking (UNIQUE booking_id) — re-rating updates it;
--   * partner_id and founder_user_id are copied from the booking row by the
--     Worker, never taken from the request, so a rating cannot be aimed at
--     another partner.
--
-- STANDS ALONE: partner_bookings, partners and users are existing tables.
-- CREATE … IF NOT EXISTS only, no BEGIN/COMMIT. Apply with the ledger-driven
-- runner:
--   npm run d1:migrate:remote

CREATE TABLE IF NOT EXISTS partner_booking_ratings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  booking_id INTEGER NOT NULL UNIQUE REFERENCES partner_bookings(id) ON DELETE CASCADE,
  partner_id INTEGER NOT NULL REFERENCES partners(id),
  founder_user_id INTEGER NOT NULL REFERENCES users(id),
  rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_partner_booking_ratings_partner
  ON partner_booking_ratings (partner_id);
