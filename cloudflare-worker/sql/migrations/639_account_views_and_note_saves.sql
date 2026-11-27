-- 639 — Accounts part 4: saved views of All accounts, and who saved an
-- account's notes and when (D1303, #3400, part 4 of #2377).
--
--   account_saved_views   a named set of All accounts' filters and sort
--                         (ACC3 "Save this view…"). `scope` says who reads it,
--                         as the creator chose: 'admin' is only them,
--                         'studio' is every admin of this studio. A studio is
--                         its own database (D106), so 'studio' means every
--                         admin on this deployment, never another studio's.
--                         `query_json` holds the list's own filter keys and
--                         string values only (the route checks them); it is
--                         never a SQL fragment.
--   account_note_saves    the last save of an account's internal notes
--                         (ACC6 "Last saved on [date] by [Admin Name]"): one
--                         row per account, who saved, when, and the length.
--                         The notes stay in `users.admin_notes`; `users` is at
--                         D1's column limit (migration 154), so the metadata
--                         is a sidecar. Each save is also the
--                         `admin_notes_updated` activity row it already was.
--
-- No backfill: a view nobody saved is none, and a note saved before this
-- migration has no recorded saver ("Not recorded"), never a guessed one.
--
-- Grep first (D689 D-t): no `account_saved_views` or `account_note_saves`
-- table exists in an earlier migration or in schema_baseline.sql
-- (`deal_saved_views`, migration 619, is Deal flow's and is not touched).
--
-- Additive: CREATE ... IF NOT EXISTS only.

CREATE TABLE IF NOT EXISTS account_saved_views (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  uid            TEXT NOT NULL UNIQUE DEFAULT (lower(hex(randomblob(16)))),
  name           TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 60),
  scope          TEXT NOT NULL CHECK (scope IN ('admin', 'studio')),
  owner_user_id  INTEGER NOT NULL REFERENCES users(id),
  query_json     TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(query_json) AND json_type(query_json) = 'object'),
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_account_saved_views_owner ON account_saved_views (owner_user_id, id);
CREATE INDEX IF NOT EXISTS idx_account_saved_views_scope ON account_saved_views (scope, id);
-- One name per reader: an admin's own views, and the studio's, are each unique by name.
CREATE UNIQUE INDEX IF NOT EXISTS uq_account_saved_views_own ON account_saved_views (owner_user_id, lower(name)) WHERE scope = 'admin';
CREATE UNIQUE INDEX IF NOT EXISTS uq_account_saved_views_studio ON account_saved_views (lower(name)) WHERE scope = 'studio';

CREATE TABLE IF NOT EXISTS account_note_saves (
  user_id     INTEGER PRIMARY KEY REFERENCES users(id),
  saved_by    INTEGER REFERENCES users(id),
  saved_at    TEXT NOT NULL DEFAULT (datetime('now')),
  chars       INTEGER NOT NULL CHECK (typeof(chars) = 'integer' AND chars >= 0)
);
