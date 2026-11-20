-- D6957: one row per Sign in with Apple identity linked to an Axal VC account.
-- A side table, as user_google_links (065) is, because users is at D1's
-- column limit. user_id is the key, so an account has at most one Apple ID;
-- apple_sub is UNIQUE, so an Apple ID signs in to at most one account.
-- private_email records whether Apple gave a Hide My Email relay address.
CREATE TABLE user_apple_links (
  user_id INTEGER PRIMARY KEY,
  apple_sub TEXT NOT NULL UNIQUE,
  private_email INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
