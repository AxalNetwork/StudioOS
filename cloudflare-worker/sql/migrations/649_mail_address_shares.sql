-- 649 — Network members email each other after a mutual accept, each sharing
-- their own address (D1342, #3550; part 3 of #3547, the owner's option A).
--
-- WHAT IT IS. One row per pair of members whose introduction both accepted:
-- `user_low` is the lower user id, `user_high` the higher, so a pair is one
-- row whichever side opens it. `source_kind` says what matched them, an
-- introduction proposition (`source_ref` its uid) or a match; today only a
-- mutually accepted introduction creates a row (`routes/introductions.ts`).
--
-- EACH SIDE'S OWN CONSENT. `*_shared_at` is when that member shared their
-- address, `*_declined_at` when they said no, `*_revoked_at` when they took a
-- share back. A member's address is served to the other only while BOTH
-- sides have shared and neither has revoked or declined since. Sharing again
-- clears that side's decline and revoke.
--
-- D414's rule stands: no other route serves another member's address.
--
-- Additive and idempotent.

CREATE TABLE IF NOT EXISTS mail_address_shares (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  user_low INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user_high INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source_kind TEXT NOT NULL CHECK (source_kind IN ('introduction', 'match')),
  source_ref TEXT NOT NULL,
  low_shared_at TEXT,
  low_declined_at TEXT,
  low_revoked_at TEXT,
  high_shared_at TEXT,
  high_declined_at TEXT,
  high_revoked_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (user_low < user_high),
  UNIQUE (user_low, user_high)
);
CREATE INDEX IF NOT EXISTS idx_mail_address_shares_high ON mail_address_shares(user_high);
