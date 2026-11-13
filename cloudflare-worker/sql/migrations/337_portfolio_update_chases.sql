-- 337_portfolio_update_chases.sql — the chase log (D464, wave 8, Session 17,
-- item 5).
--
-- Canvas IP2's "Chase all overdue" and the Portfolio canvas's per-company
-- Nudge are the same act: an investor asks a silent company for its update.
-- Nothing recorded it — the only outbound on the updates desk fired when an
-- update ARRIVED. `portfolio_update_chases` is the log: who chased, which
-- company, when. One row per chase (a repeat chase later is a new row; a
-- double-click inside an hour is not — the route answers the existing row).
--
-- The notification to the founder goes through services/notify.ts with type
-- `portfolio_update_chase`; the settings type map row is Session 4's to add
-- (their file), and the notify call delivers without it (channels default on,
-- Slack falls through to the generic header).
--
-- STANDS ALONE and idempotent. Apply through the ledger-driven runner:
--
--   npm run d1:migrate:remote

CREATE TABLE IF NOT EXISTS portfolio_update_chases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT UNIQUE NOT NULL,
  project_id INTEGER NOT NULL REFERENCES projects(id),
  chased_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_puc_project ON portfolio_update_chases(project_id, created_at);
CREATE INDEX IF NOT EXISTS idx_puc_chaser ON portfolio_update_chases(chased_by, created_at);
