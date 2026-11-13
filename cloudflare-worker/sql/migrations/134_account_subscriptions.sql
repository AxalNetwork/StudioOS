-- Task — Persona (account-plan) subscriptions.
--
-- Generic subscription state for any signed-in role that isn't a founder or
-- investor (partner, advisor/mentor, and any future persona). Founder and
-- investor keep their own dedicated columns/tables; this is the pipeline for
-- every other role. Keyed by user_id, one active plan per account.
--
-- The `users` table sits at D1's hard 100-column limit, so this state CANNOT be
-- new columns on `users` — it lives in this side table instead, exactly like
-- `mi_pro_subscriptions`. See .agents/memory/d1-users-column-limit.md.
--
-- Canonical DDL. Mirrored statement-for-statement by
-- services/accountPlans.ts (ensureAccountPlanSchema) so dev/preview D1 — which
-- never runs `wrangler d1 execute` — self-heals if this lands un-applied.
-- Every statement is additive + idempotent and NEVER seeds a row.
CREATE TABLE IF NOT EXISTS account_subscriptions (
  user_id INTEGER PRIMARY KEY,
  plan_group TEXT,
  plan TEXT,
  status TEXT NOT NULL DEFAULT 'free',
  subscription_id TEXT,
  period_end TEXT,
  trial_end TEXT,
  stripe_customer_id TEXT,
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_account_sub_customer ON account_subscriptions(stripe_customer_id);
-- UNIQUE — a Stripe subscription_id identifies at most one row; the webhook's
-- subscription_id-scoped writes (delete → cancelled) rely on it.
CREATE UNIQUE INDEX IF NOT EXISTS idx_account_sub_subscription ON account_subscriptions(subscription_id);
CREATE INDEX IF NOT EXISTS idx_account_sub_status ON account_subscriptions(status);
