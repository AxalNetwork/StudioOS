-- 302_push_subscriptions.sql — D335 (wave 8, Session 4, item 6).
--
-- Storage for `frontend/src/lib/pwa.js`'s `enablePush()`/`disablePush()`,
-- which have called `api.pushSubscribe()`/`api.pushUnsubscribe()` since
-- Task #57 with no worker route and no table to land in — both were listed
-- in `scripts/api-drift-baseline.json` as known debt. One row per browser
-- subscription (a user can have several — phone, laptop, …), keyed on the
-- endpoint URL the push service assigned it, which is unique per
-- subscription by construction.
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  expiration_time INTEGER,
  user_agent TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  last_sent_at TIMESTAMP,
  -- Set on a 404/410 from the push service (RFC 8030 §7.2 — the
  -- subscription is gone on the browser's side) so a dead endpoint stops
  -- being retried without a second write to delete the row outright on a
  -- path that may be mid-send.
  last_error TEXT
);

CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user ON push_subscriptions(user_id);
