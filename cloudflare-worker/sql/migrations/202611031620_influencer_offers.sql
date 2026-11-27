-- D4293 (#4293, D4289 P4 of #4289) — influencer offers: a promotion code HQ
-- made in Promos (D1270–D1275), owned by an influencer, applied at checkout to
-- a member that influencer referred, inside a budget.
--
-- ONE OWNER PER CODE. `promo_id` is UNIQUE: a code belongs to one influencer.
-- The code's own rules stay the code's (plans, intervals, once per member,
-- first purchase only, expiry, pause and end); the offer adds the owner, the
-- budget and its own status.
--
-- THE BUDGET IS SPENT FROM THE REDEMPTIONS. What an offer has given is the
-- sum of `promo_redemptions.discount_cents` for its code in the budget's
-- currency (D1274 records the discount on every path). Nothing here keeps a
-- running total that could drift from it.
--
-- `influencer_user_id` is the influencer's account. P1 (#4290) keys the
-- membership by `influencers.user_id` UNIQUE, so the account is the join key
-- and this part does not depend on P1's table shape.
--
-- `referral_partner_terms.offer_budget_cents` (D-b: a tier's rate, duration and
-- offer budget are terms) caps the total discount across all of an
-- influencer's offers. NULL is no cap beyond each offer's own budget.
--
-- This file is stamped 202611031620 so it runs after
-- `202611031502_influencer_program.sql`, which rebuilds referral_partner_terms.
-- An earlier stamp would add the column and then lose it in that rebuild.

CREATE TABLE IF NOT EXISTS influencer_offers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  influencer_user_id INTEGER NOT NULL REFERENCES users(id),
  promo_id TEXT NOT NULL UNIQUE REFERENCES promo_codes(id),
  budget_cents INTEGER NOT NULL CHECK (budget_cents > 0),
  currency TEXT NOT NULL CHECK (length(currency) = 3 AND currency = upper(currency)),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'ended')),
  -- The offer the public @handle page shows (P2's read); at most one per influencer.
  featured INTEGER NOT NULL DEFAULT 0 CHECK (featured IN (0, 1)),
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  ended_at TEXT,
  CHECK (status <> 'ended' OR ended_at IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_influencer_offers_owner ON influencer_offers(influencer_user_id, status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_influencer_offers_featured ON influencer_offers(influencer_user_id) WHERE featured = 1;

-- "Ask HQ for an offer": one row per request, HQ is notified.
CREATE TABLE IF NOT EXISTS influencer_offer_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  influencer_user_id INTEGER NOT NULL REFERENCES users(id),
  message TEXT NOT NULL CHECK (length(message) BETWEEN 1 AND 2000),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'answered', 'closed')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_influencer_offer_requests_owner ON influencer_offer_requests(influencer_user_id, created_at);

ALTER TABLE referral_partner_terms ADD COLUMN offer_budget_cents INTEGER CHECK (offer_budget_cents IS NULL OR offer_budget_cents > 0);
