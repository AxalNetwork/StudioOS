-- 629 — Promo codes part 2: paused and ended recorded, a reason, name and note,
-- the repeating months, and what replaced a code (D1272, #3298).
-- Reserved for this part by S21 in D1270 §6 (#2381).
--
-- Before this, Pause and Delete both left `active = 0`, so the page could not
-- tell a code paused for a while from one ended for good, and nothing said why.
-- These columns record each fact on the mirror (Stripe stays the source of
-- truth for the discount, the cap and the expiry, which it keeps fixed):
--   paused_at, paused_by    when and by whom a code was paused; cleared on resume
--   ended_at, ended_by      when and by whom it was ended; an ended code never
--                           resumes (the route refuses), so these are never cleared
--   reason                  the reason given for the last pause, resume or end
--   name, note              HQ's own words for the code; also on the Stripe
--                           promotion code's metadata
--   duration_in_months      the months a `repeating` coupon runs; NULL for
--                           once or forever, and for codes made before this,
--                           which read "Not recorded"
--   replaced_by             the promotion code id that replaced this one, when
--                           it was ended by Replace
--
-- Grep first (D689 D-t): none of these columns is declared on promo_codes in an
-- earlier migration or in schema_baseline.sql. `ensurePromoSchema`
-- (services/promos.ts) declares the same shape for a database this migration
-- has not reached.

ALTER TABLE promo_codes ADD COLUMN paused_at TEXT;
ALTER TABLE promo_codes ADD COLUMN paused_by INTEGER;
ALTER TABLE promo_codes ADD COLUMN ended_at TEXT;
ALTER TABLE promo_codes ADD COLUMN ended_by INTEGER;
ALTER TABLE promo_codes ADD COLUMN reason TEXT;
ALTER TABLE promo_codes ADD COLUMN name TEXT;
ALTER TABLE promo_codes ADD COLUMN note TEXT;
ALTER TABLE promo_codes ADD COLUMN duration_in_months INTEGER;
ALTER TABLE promo_codes ADD COLUMN replaced_by TEXT;

CREATE INDEX IF NOT EXISTS idx_promo_codes_created ON promo_codes(created_at);
