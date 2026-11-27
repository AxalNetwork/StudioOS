-- 578 — billing alerts: a plan payment that needs the member (D1052, #2903).
-- Reserved for D1052 on #2903 (part 4 of Checkout, #2451), 2026-10-25.
--
-- D892 tells the member of each failed renewal attempt, but nothing records
-- that an alert is open, so no banner can show and a bank's confirmation
-- request (`invoice.payment_action_required`) is not handled. One row per
-- thing the member should know about, written by the verified Stripe webhook:
--
--   kind                state           object_id      closed by
--   payment_failed      open → closed   the invoice    invoice.paid, the subscription active again, or ended
--   needs_confirmation  open → closed   the invoice    the same
--   refund              closed          the charge     (recorded and told; nothing to do)
--   dispute             open → closed   the dispute    charge.dispute.closed
--
-- It is never on `users`, which is at D1's column limit. No card data is held:
-- the client secret a confirmation needs is fetched from Stripe only when the
-- member presses Confirm.
--
-- IDEMPOTENT ON THE EVENT OBJECT'S ID. `(kind, object_id)` is unique, so a
-- redelivered event updates the row it wrote and never adds a second; a closed
-- row is never reopened by a late event.
--
-- Grep first (D689 D-t): no `billing_alerts` table exists in any earlier
-- migration or the baseline.
CREATE TABLE IF NOT EXISTS billing_alerts (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id         INTEGER NOT NULL,
  kind            TEXT NOT NULL CHECK (kind IN ('payment_failed', 'needs_confirmation', 'refund', 'dispute')),
  state           TEXT NOT NULL DEFAULT 'open' CHECK (state IN ('open', 'closed')),
  object_id       TEXT NOT NULL,
  subscription_id TEXT,
  invoice_id      TEXT,
  plan_family     TEXT,
  attempt_count   INTEGER,
  next_attempt_at TEXT,
  amount_cents    INTEGER,
  currency        TEXT,
  closed_reason   TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
  closed_at       TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_billing_alerts_object ON billing_alerts (kind, object_id);
CREATE INDEX IF NOT EXISTS idx_billing_alerts_user_state ON billing_alerts (user_id, state);
CREATE INDEX IF NOT EXISTS idx_billing_alerts_subscription ON billing_alerts (subscription_id, state);
