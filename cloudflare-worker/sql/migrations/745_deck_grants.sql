-- D1587 (#3834, owner decision R = B): a founder grants one frozen version of
-- the venture's deck to an investor on a deal, read on the investor's own deal
-- page. One live grant per deal, investor and firm; withdrawing keeps the row
-- (`revoked_at`). `include_json` is what the founder ticked, read through
-- `services/decks/shareInclude.ts` as a share link's is. Additive only; the
-- ledger runner applies it.
CREATE TABLE IF NOT EXISTS deck_grants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  deal_id INTEGER NOT NULL REFERENCES deals(id),
  deck_id INTEGER NOT NULL REFERENCES pitch_decks(id),
  investor_user_id INTEGER NOT NULL REFERENCES users(id),
  company_id INTEGER REFERENCES company_profiles(id),
  include_json TEXT,
  granted_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  revoked_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_deck_grants_live ON deck_grants(deal_id, investor_user_id, IFNULL(company_id, 0)) WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_deck_grants_deal ON deck_grants(deal_id, created_at);
