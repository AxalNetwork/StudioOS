-- 511 — opt-in auto-reload of AI tokens (D794, #2219).
--
-- Off by default. A member who turns it on chooses a pack (the amount charged
-- each time) and a threshold ("reload when my token balance drops below $X").
-- When a settled run takes the balance below the threshold, the Worker charges
-- the member's saved card off-session for that pack, as an ordinary pack order
-- (D755): the webhook credits it, its invoice is the order's, and a refund or
-- dispute takes it back the same way.
--
-- `stripe_payment_method` is the card saved through a SetupIntent with
-- `usage = off_session`, entered on Stripe's own element. StudioOS keeps only
-- its id, never a card number.
--
-- `last_crossing` names the balance crossing the last reload was for: the
-- latest credited pack's payment intent ('none' before the first). One crossing
-- causes one charge, also after Stripe's 24-hour idempotency window. A crossing
-- changes only when a new pack is credited.
--
-- A declined or authentication-required card sets `enabled = 0` with
-- `disabled_reason`; the member turns it back on after updating the card.
--
-- The lock: one reload runs at a time per member. `locked_until` lets a lock
-- left by a crashed run expire.
--
-- Additive and idempotent. No row is seeded: a member with no row has
-- auto-reload off.
CREATE TABLE IF NOT EXISTS member_ai_auto_reload (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
  pack_uid TEXT NOT NULL,
  threshold_microusd INTEGER NOT NULL CHECK (threshold_microusd >= 0),
  stripe_payment_method TEXT,
  last_attempt_at TEXT,
  last_outcome TEXT,
  disabled_reason TEXT,
  last_crossing TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS member_ai_reload_locks (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  locked_until TEXT NOT NULL
);
