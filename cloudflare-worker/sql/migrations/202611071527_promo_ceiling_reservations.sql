-- D4855 (#4855): the promotion ceiling is enforced where a promo code is redeemed.
--
-- A branch holds the ceiling HQ pushed (`branch_promo_ceiling`, migration 256)
-- and nothing recorded what had been spent against it, so the ceiling was a
-- figure no checkout read. This ledger is that record: one row per checkout
-- that took a discount, keyed by the checkout's own reference so a repeated
-- attempt is the same row and never a second spend.
--
--   reserved   taken when the checkout starts; counts against the ceiling
--              until `expires_at`, so an abandoned checkout frees itself
--   committed  the payment (or the subscription's first invoice) went through;
--              counts for good
--   released   the checkout failed before any payment; counts for nothing
--
-- The check and the write are ONE statement (`services/promoRedemption.ts`):
-- the row is inserted only while the live total plus this discount stays within
-- the ceiling, so two checkouts at once cannot both take the last of it.
--
-- Additive; no existing row changes. HQ never writes here: a code names no
-- licence, so only a branch Worker (which has a ceiling) reserves.
CREATE TABLE IF NOT EXISTS promo_ceiling_reservations (
  ref          TEXT PRIMARY KEY,
  period       TEXT NOT NULL,
  currency     TEXT NOT NULL,
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  promo_id     TEXT NOT NULL,
  user_id      INTEGER,
  state        TEXT NOT NULL CHECK (state IN ('reserved', 'committed', 'released')),
  expires_at   TEXT,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_promo_ceiling_res_live
  ON promo_ceiling_reservations(period, currency, state);
