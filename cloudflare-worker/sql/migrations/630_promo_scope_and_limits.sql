-- 630 — a promo code's plan and interval scope, and its per-member limits
-- (D1273, #3299, part 3 of #2381). Assigned by S1 on #3299.
--
-- WHAT EACH COLUMN MEANS
--
--   plan_keys_json       The plans HQ chose, as `tier:growth`, `investor:professional`,
--                        `plan:<group>` or `mi:mi_pro`. '[]' when none was chosen.
--                        Each plan resolves at create to its catalog products, which
--                        join `product_ids_json`, so Stripe's own `applies_to` and
--                        checkout's product check enforce it. This column is the
--                        record of what HQ asked for.
--   intervals_json       The billing intervals a subscription may use the code on:
--                        a JSON array of 'month' and 'year'. NULL for a code made
--                        before 630: it applied to every interval when it was made,
--                        and it still does. Every code made from 630 on writes its
--                        list; #2381 owner question 3 makes monthly only the default.
--                        Stripe cannot restrict a promotion code by interval, so the
--                        Worker refuses `interval_not_eligible` before a
--                        subscription starts.
--   once_per_member      1: one use per member. A one-time purchase records its
--                        use in `promo_redemptions` (the webhook, or the free
--                        unlock's own row); a subscription reserves the member's
--                        use before Stripe is asked (`member:<promo>:<user>`). 0 for
--                        a code made before 630, which had no such limit.
--   first_purchase_only  1: only a member who has never paid. Also set on the
--                        Stripe promotion code (`restrictions[first_time_transaction]`),
--                        so Stripe enforces it on a subscription too.
--
-- NO CHECK CONSTRAINTS. `ensurePromoSchema` adds the same columns on a store
-- that never ran this file, and a constraint present on one path and not the
-- other is a difference nobody sees until it bites (advisorStoresSchema.ts).
-- The writer stores only 0, 1 and arrays it built itself.
--
-- Grep first (D689 D-t): no earlier migration and no schema_baseline.sql
-- column has any of these names.
ALTER TABLE promo_codes ADD COLUMN plan_keys_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE promo_codes ADD COLUMN intervals_json TEXT;
ALTER TABLE promo_codes ADD COLUMN once_per_member INTEGER NOT NULL DEFAULT 0;
ALTER TABLE promo_codes ADD COLUMN first_purchase_only INTEGER NOT NULL DEFAULT 0;

-- One member's uses of one code, read by the once-per-member check.
CREATE INDEX IF NOT EXISTS idx_promo_redemptions_promo_user ON promo_redemptions(promo_id, user_id);
