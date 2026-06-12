-- Task #7 — À La Carte feature unlocks.
--
-- One row per purchased à la carte unlock. A successful Stripe PaymentIntent
-- whose metadata carries `kind=alacarte` + `feature_key` writes a row here from
-- the billing webhook (`payment_intent.succeeded`). Feature gates then check
-- this table for a non-expired row to grant access without a subscription.
--
--   expires_at NULL              → permanent unlock (never expires)
--   expires_at in the future     → active unlock
--   expires_at in the past       → lapsed (gate treats as absent)
--
-- `source_payment_intent_id` is UNIQUE so re-delivered webhooks are idempotent
-- (INSERT OR IGNORE). Caveat: D1/SQLite lack ALTER TABLE ... IF NOT EXISTS, so
-- the in-code lazy bootstrap (`ensureFeatureUnlockSchema` in
-- services/featureUnlocks.ts) creates this table on first run if this migration
-- hasn't been applied yet; re-running this migration errors harmlessly on an
-- already-existing table.

CREATE TABLE IF NOT EXISTS feature_unlocks (
  id                       INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id                  INTEGER NOT NULL,
  feature_key              TEXT NOT NULL,
  expires_at               TEXT,                       -- NULL = permanent
  source_payment_intent_id TEXT,                       -- Stripe pi_... (idempotency anchor)
  created_at               TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Idempotency: one unlock row per Stripe PaymentIntent.
CREATE UNIQUE INDEX IF NOT EXISTS idx_feature_unlocks_pi
  ON feature_unlocks(source_payment_intent_id);

-- Hot path: "does this user have an active unlock for this feature?"
CREATE INDEX IF NOT EXISTS idx_feature_unlocks_user_feature
  ON feature_unlocks(user_id, feature_key);
