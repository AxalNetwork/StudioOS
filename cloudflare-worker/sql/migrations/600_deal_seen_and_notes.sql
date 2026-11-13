-- D1150 / #3055. No historical visits or notes are inferred.
CREATE TABLE IF NOT EXISTS deal_seen (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE DEFAULT (lower(hex(randomblob(16)))),
  deal_id INTEGER NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  company_id INTEGER REFERENCES company_profiles(id) ON DELETE CASCADE,
  last_seen_at TEXT NOT NULL,
  source_snapshot_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(source_snapshot_json)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE(deal_id, user_id, company_id)
);
CREATE TABLE IF NOT EXISTS deal_notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE DEFAULT (lower(hex(randomblob(16)))),
  deal_id INTEGER NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  author_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  company_id INTEGER REFERENCES company_profiles(id) ON DELETE CASCADE,
  tag TEXT NOT NULL DEFAULT '' CHECK(length(tag) <= 80),
  body TEXT NOT NULL CHECK(length(trim(body)) BETWEEN 1 AND 10000),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_deal_notes_firm ON deal_notes(deal_id, company_id, id DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_deal_seen_scope ON deal_seen(deal_id,user_id,COALESCE(company_id,0));
