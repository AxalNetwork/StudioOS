-- Task — Unify investor preferences & thesis.
--
-- Makes investor_profiles the single canonical store. Adds the onboarding
-- fields the investor wizard collected but the save path dropped
-- (accreditation status, country, firm name, LP intent, LP target, notes),
-- then does a one-time backfill from the retired user_preferences store.
--
-- Caveat: D1 and SQLite lack ALTER TABLE ADD COLUMN IF NOT EXISTS, so this
-- migration is NOT idempotent — re-running the ALTERs fails on duplicate
-- column and the forward-only runner aborts loudly. In prod that never
-- happens: migrations run once (predeploy) and the ledger skips applied
-- files. The in-code lazy-bootstrap (investor_signals.ts) also adds these
-- columns at runtime, so on a local/preview DB where the new Worker already
-- booted, record this file via the baseline path rather than re-applying it.

ALTER TABLE investor_profiles ADD COLUMN accreditation_status TEXT;
ALTER TABLE investor_profiles ADD COLUMN country TEXT;
ALTER TABLE investor_profiles ADD COLUMN firm_name TEXT;
ALTER TABLE investor_profiles ADD COLUMN lp_intent TEXT;
ALTER TABLE investor_profiles ADD COLUMN lp_target_usd INTEGER;
ALTER TABLE investor_profiles ADD COLUMN notes TEXT;

-- The retired preferences store is created lazily by the matches route at
-- runtime, so it may not exist on a fresh DB. Guard the one-time backfill so
-- this migration is safe to run everywhere.
CREATE TABLE IF NOT EXISTS user_preferences (
  user_id INTEGER PRIMARY KEY,
  investment_focus TEXT,
  preferred_stages TEXT,
  preferred_roles TEXT,
  min_check_cents INTEGER,
  max_check_cents INTEGER,
  risk_tolerance TEXT,
  bio TEXT,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- One-time migration of user_preferences into the canonical investor_profiles.
-- Only clean 1:1 fields are carried over: bio -> thesis_text (only when the
-- profile has no thesis yet) and check-size cents -> ticket USD (only when
-- unset). The two stores use DIFFERENT sector/stage taxonomies, so
-- investment_focus/preferred_stages are intentionally NOT mapped — mapping
-- them would corrupt the canonical enums.
INSERT INTO investor_profiles (user_id, thesis_text, ticket_min_usd, ticket_max_usd, updated_at)
SELECT
  up.user_id,
  NULLIF(TRIM(COALESCE(up.bio, '')), ''),
  CASE WHEN up.min_check_cents IS NOT NULL THEN up.min_check_cents / 100 ELSE NULL END,
  CASE WHEN up.max_check_cents IS NOT NULL THEN up.max_check_cents / 100 ELSE NULL END,
  CURRENT_TIMESTAMP
FROM user_preferences up
WHERE NULLIF(TRIM(COALESCE(up.bio, '')), '') IS NOT NULL
   OR up.min_check_cents IS NOT NULL
   OR up.max_check_cents IS NOT NULL
ON CONFLICT(user_id) DO UPDATE SET
  thesis_text = COALESCE(NULLIF(TRIM(COALESCE(investor_profiles.thesis_text, '')), ''), excluded.thesis_text),
  ticket_min_usd = COALESCE(investor_profiles.ticket_min_usd, excluded.ticket_min_usd),
  ticket_max_usd = COALESCE(investor_profiles.ticket_max_usd, excluded.ticket_max_usd),
  updated_at = CURRENT_TIMESTAMP;
