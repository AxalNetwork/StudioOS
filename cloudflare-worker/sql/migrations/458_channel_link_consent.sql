-- 458 — D684 #1602, allocated by S1 on the issue.
-- Additive: both owners consent within the ORIGINAL ten-minute code lifetime.
-- Pending identity details are encrypted with columnCipher and the code UID.
ALTER TABLE channel_link_codes ADD COLUMN claim_details_enc TEXT;
ALTER TABLE channel_link_codes ADD COLUMN axal_confirmed_at TEXT;
ALTER TABLE channel_link_codes ADD COLUMN activated_at TEXT;
ALTER TABLE channel_link_codes ADD COLUMN cancelled_at TEXT;

-- Old one-sided pending codes cannot be grandfathered into two-sided consent.
-- Active integrations are untouched; members request a fresh code.
UPDATE channel_link_codes SET cancelled_at = datetime('now');
CREATE INDEX idx_channel_link_codes_member ON channel_link_codes(user_id, provider, id);

-- Independent of integrations: attempts exist before an account is linked.
-- Domain-separated HMAC of IP/account, UTC hour, count; no raw IP or identity.
CREATE TABLE channel_link_attempts (
  subject_hash TEXT NOT NULL,
  window_start TEXT NOT NULL,
  n INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (subject_hash, window_start)
);
CREATE INDEX idx_channel_link_attempts_window ON channel_link_attempts(window_start);
