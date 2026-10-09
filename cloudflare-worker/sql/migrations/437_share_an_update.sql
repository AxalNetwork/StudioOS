-- 437 — Grow › Share an update, built on portfolio_updates (D654, #1466).
--
-- One update, written once and sent to investors, the team and the Axal
-- network. It is still a `portfolio_updates` row: no second updates store.
-- This adds what the "Share an update" sheet records on that row, and three
-- tables beside it.
--
--   period_start / period_end  the dates the update covers (YYYY-MM-DD).
--   metrics_json               [{ key, label, value, source, as_of }] — each
--                              figure with its source and date. A figure no
--                              store recorded is value NULL ("Not recorded"),
--                              never 0. An empty list sends with the metrics
--                              left out.
--   highlights_json / lowlights_json
--                              [{ text, source: { label, ref, as_of } }] —
--                              every line names its source.
--   audience_json              { investors, team, network } on or off.
--   network_includes_metrics   0: the Axal network gets the asks only.
--   sent_at                    when it was sent; NULL while a draft.
--
-- update_asks         one typed ask (hire, customer, partner, market, capital)
--                     and the module item it links to.
-- update_ask_replies  a reply to an ask, and the module item it became.
-- update_recipients   who it was sent to, through which path, and when each
--                     opened it.
--
-- Additive: ADD COLUMN and CREATE TABLE IF NOT EXISTS. No row is changed.
ALTER TABLE portfolio_updates ADD COLUMN period_start TEXT;
ALTER TABLE portfolio_updates ADD COLUMN period_end TEXT;
ALTER TABLE portfolio_updates ADD COLUMN metrics_json TEXT;
ALTER TABLE portfolio_updates ADD COLUMN highlights_json TEXT;
ALTER TABLE portfolio_updates ADD COLUMN lowlights_json TEXT;
ALTER TABLE portfolio_updates ADD COLUMN audience_json TEXT;
ALTER TABLE portfolio_updates ADD COLUMN network_includes_metrics INTEGER NOT NULL DEFAULT 0;
ALTER TABLE portfolio_updates ADD COLUMN sent_at TEXT;

CREATE TABLE IF NOT EXISTS update_asks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT UNIQUE NOT NULL,
  update_id INTEGER NOT NULL REFERENCES portfolio_updates(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('hire', 'customer', 'partner', 'market', 'capital')),
  text TEXT NOT NULL,
  link_module TEXT,
  link_ref TEXT,
  asked_again_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_update_asks_update ON update_asks(update_id);

CREATE TABLE IF NOT EXISTS update_ask_replies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT UNIQUE NOT NULL,
  ask_id INTEGER NOT NULL REFERENCES update_asks(id) ON DELETE CASCADE,
  replier_user_id INTEGER REFERENCES users(id),
  name TEXT,
  email TEXT,
  message TEXT NOT NULL,
  landed_module TEXT,
  landed_ref TEXT,
  landed_reason TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_update_ask_replies_ask ON update_ask_replies(ask_id);

CREATE TABLE IF NOT EXISTS update_recipients (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  update_id INTEGER NOT NULL REFERENCES portfolio_updates(id) ON DELETE CASCADE,
  audience TEXT NOT NULL CHECK (audience IN ('investor', 'team', 'network')),
  user_id INTEGER REFERENCES users(id),
  email TEXT,
  label TEXT,
  delivered_via TEXT,
  not_delivered_reason TEXT,
  opened_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_update_recipients_update ON update_recipients(update_id);
CREATE INDEX IF NOT EXISTS idx_update_recipients_user ON update_recipients(user_id);
