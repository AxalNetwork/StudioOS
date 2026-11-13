-- 585 — Lovable part 3: app links and founder-pressed live checks (D1083,
-- #2948, part 3 of #2398). Number given by the issue (S1, 2026-10-25).
--
-- One row is the address Lovable gave the founder, pasted onto one record:
--   module 'experiments'   → record_table 'hypothesis_experiments', record_id
--                            the experiment's id (Validate › Hypotheses);
--   module 'prototype-mvp' → record_table 'projects', record_id the project's
--                            id (Build › Prototype / MVP).
-- One link per record: UNIQUE(record_table, record_id).
--
-- app_url             https only, a public host (webFetch.isSafePublicUrl),
--                     written only by routes/lovable_app_links.ts.
-- lovable_project_id  NULL until Lovable part 6 (D1313) reads it from the
--                     founder's key; nothing writes it here.
-- last_status         'live' or 'not_reachable', from the last Check now.
--                     NULL until the founder presses it once: "Not checked".
-- last_title          the fetched page's <title>, as plain text, at most 120
--                     characters. NULL when the page had none.
-- checked_at          when Check now last ran. There is no cron: only the
--                     founder's press writes it.
--
-- Grep first (D689 D-t): no `lovable_app_links` table and no column named
-- `lovable_project_id` exists in an earlier migration or in
-- schema_baseline.sql. A new table, so nothing is backfilled.

CREATE TABLE IF NOT EXISTS lovable_app_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  module TEXT NOT NULL CHECK (module IN ('experiments', 'prototype-mvp')),
  record_table TEXT NOT NULL CHECK (record_table IN ('hypothesis_experiments', 'projects')),
  record_id INTEGER NOT NULL,
  app_url TEXT NOT NULL CHECK (app_url LIKE 'https://%' AND length(app_url) <= 2048),
  lovable_project_id TEXT,
  last_status TEXT CHECK (last_status IS NULL OR last_status IN ('live', 'not_reachable')),
  last_title TEXT CHECK (last_title IS NULL OR length(last_title) <= 120),
  checked_at TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (record_table, record_id)
);

CREATE INDEX IF NOT EXISTS idx_lovable_app_links_project ON lovable_app_links(project_id, module);
