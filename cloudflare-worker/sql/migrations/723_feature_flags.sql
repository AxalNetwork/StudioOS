-- 723 — feature flags for The Grid (D1509, #3760, deck v2 A16).
-- Number named on #3760 and checked free on 2026-11-01: no file 723 is on
-- main, and no open pull request uses it.
--
-- feature_flags  one row per flag key, scope and scope id: whether the flag
--                is on there. Read by services/featureFlags.ts through a 60 s
--                KV cache, so a change reaches every chip within a minute.
--   key         'grid_generate' (the one-click run and area generation),
--               'element:<id>' (one grid element, `elementModels.ELEMENTS`)
--               or 'model:<catalogue id>' (one model, services/ai/catalogue.ts).
--               No CHECK list: the route refuses any other key before it
--               writes, and a row whose key nothing reads changes nothing.
--   scope       'global' (everyone), 'role' (one role: 'admin' is HQ) or
--               'user' (one member, the beta cohort). The narrowest row
--               wins: user, then role, then global.
--   scope_id    '' for global; the role name; the user id as text. Never a
--               name or an email.
--   enabled     1 on, 0 off. (The spec's `on`: ON is an SQL keyword, so the
--               column is `enabled`.) No row means the flag's default (on:
--               a flag is a switch HQ turns off, D1509 §2).
--   updated_by  the admin who wrote the row (NULL once that account goes).
--   updated_at  when it was last written.
--
-- Configuration, not a venture write: no activity_logs row. Retention: kept
-- until changed or cleared (a PUT with null deletes the row).
--
-- Additive: CREATE TABLE IF NOT EXISTS only. No BEGIN/COMMIT.
CREATE TABLE IF NOT EXISTS feature_flags (
  key TEXT NOT NULL,
  scope TEXT NOT NULL CHECK (scope IN ('global', 'role', 'user')),
  scope_id TEXT NOT NULL DEFAULT '',
  enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
  updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (key, scope, scope_id)
);
