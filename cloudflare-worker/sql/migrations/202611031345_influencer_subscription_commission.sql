-- D4292 (#4292, D4289 P3 of #4289) — commission on an attributed member's
-- paid software subscription invoices, held 30 days, then payable; cancelled
-- or clawed back on a refund or a dispute; the milestone bonuses.
--
-- THE LEDGER IS STILL `commissions`. One row per paid invoice, `source_type`
-- 'subscription_invoice' and `source_id` the Stripe invoice id, so the
-- existing UNIQUE (user_id, source_type, source_id) makes a replayed webhook a
-- no-op. A row starts `pending` with `payable_at` 30 days after the invoice was
-- paid; the daily sweep (services/influencerCommission.ts) moves due rows to
-- `accrued`, which is the status the payout request already claims. `status`
-- carries no CHECK (baseline), so `pending` needs no table rebuild.
--
-- WHY A SIDE TABLE. A commission row says what was earned; it cannot say which
-- invoice of the member's twelve it was, which charge a refund will name,
-- whether the subscription is still live (a bonus counts only members still
-- subscribed), or which channel sent the member. `influencer_commission_invoices`
-- holds that, one row per invoice the engine looked at and paid on.
--
-- `influencer_milestones` records each milestone a referrer reached once:
-- 'bonus' rows point at the bonus commission, 'custom' rows are the notice to
-- HQ for a custom partnership.

ALTER TABLE commissions ADD COLUMN payable_at TEXT;
CREATE INDEX IF NOT EXISTS idx_commissions_pending_due ON commissions(status, payable_at);

CREATE TABLE IF NOT EXISTS influencer_commission_invoices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  commission_id INTEGER NOT NULL UNIQUE REFERENCES commissions(id),
  referrer_user_id INTEGER NOT NULL REFERENCES users(id),
  member_user_id INTEGER NOT NULL REFERENCES users(id),
  subscription_id TEXT NOT NULL,
  invoice_id TEXT NOT NULL UNIQUE,
  -- Which of the member's paid invoices on this subscription it was, from 1.
  invoice_number INTEGER NOT NULL CHECK (invoice_number >= 1),
  charge_id TEXT,
  payment_intent_id TEXT,
  net_cents INTEGER NOT NULL CHECK (net_cents > 0),
  currency TEXT NOT NULL CHECK (length(currency) = 3 AND currency = upper(currency)),
  plan_key TEXT NOT NULL,
  handle TEXT,
  channel TEXT,
  paid_at TEXT NOT NULL,
  payable_at TEXT NOT NULL,
  -- Set when a refund or dispute inside the hold cancelled the commission.
  cancelled_at TEXT,
  cancel_reason TEXT CHECK (cancel_reason IS NULL OR cancel_reason IN ('refund', 'dispute')),
  subscription_ended_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_influencer_commission_invoices_sub ON influencer_commission_invoices(subscription_id);
CREATE INDEX IF NOT EXISTS idx_influencer_commission_invoices_charge ON influencer_commission_invoices(charge_id);
CREATE INDEX IF NOT EXISTS idx_influencer_commission_invoices_pi ON influencer_commission_invoices(payment_intent_id);
CREATE INDEX IF NOT EXISTS idx_influencer_commission_invoices_referrer ON influencer_commission_invoices(referrer_user_id, member_user_id);

CREATE TABLE IF NOT EXISTS influencer_milestones (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  referrer_user_id INTEGER NOT NULL REFERENCES users(id),
  milestone INTEGER NOT NULL CHECK (milestone > 0),
  kind TEXT NOT NULL CHECK (kind IN ('bonus', 'custom')),
  -- The bonus commission; NULL for a custom-partnership notice.
  commission_id INTEGER REFERENCES commissions(id),
  customers_counted INTEGER NOT NULL,
  reached_at TEXT NOT NULL,
  UNIQUE (referrer_user_id, milestone)
);
