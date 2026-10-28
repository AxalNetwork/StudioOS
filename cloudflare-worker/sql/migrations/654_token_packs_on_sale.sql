-- 654 — the token packs on sale (D1366).
--
-- Production had no row in `ai_token_packs`, so every Add tokens and Pay said
-- "Top-up isn't available yet." These are the packs, on sale, on the Stripe
-- account production uses (the sandbox, the mode of STRIPE_SECRET_KEY):
--   * $10  adopted: the "AI top-up" product (D629), price_1UNzpEF1hAXeCvFjjXynLkhe;
--   * $25, $50 and $100  created for D1366 the way HQ › New pack does (one
--     product per pack, metadata kind=token_pack, a one-time USD price).
-- A member may also buy any whole amount from $5 to $500: that is the
-- STRIPE_PRICE_AI_TOPUP_UNIT price ($1 each, D1366 §3), never a row here.
--
-- A price the catalog mirror does not hold yet is fetched into it on the first
-- member read of /api/ai-budget/top-up (`mirrorPackPrices`), so these rows are
-- on sale without a Sync from Stripe.
--
-- When production moves to live Stripe keys these sandbox prices cannot be
-- charged: archive them in HQ › Token packs and create live ones there.
--
-- Additive and re-runnable: INSERT OR IGNORE on the unique price_id. A row HQ
-- has since changed or archived is left as it is.

INSERT OR IGNORE INTO ai_token_packs (price_id, product_id, face_cents, on_sale, sort, origin) VALUES
  ('price_1UNzpEF1hAXeCvFjjXynLkhe', 'prod_VOnQG7KMAKxp9d', 1000,  1, 10, 'adopted'),
  ('price_1UVb4qF1hAXeCvFj0nAOI1vZ', 'prod_VWeNdhDjCWvWY5', 2500,  1, 20, 'created'),
  ('price_1UVb4tF1hAXeCvFjOGgk3jgh', 'prod_VWeNuEIxcYeIFw', 5000,  1, 30, 'created'),
  ('price_1UVb4wF1hAXeCvFjx4DWS8l7', 'prod_VWeNuFSGXD16Ll', 10000, 1, 40, 'created');
