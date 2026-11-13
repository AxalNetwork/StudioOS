-- Task #6 (IF) — Per-role onboarding checklist + product-tour tracking.
--
-- onboarding_checklist_progress  → one row per (user, item) with completed_at /
--                                  skipped_at timestamps. Either column NULL
--                                  means "pending". Manual complete and
--                                  auto-detect both write completed_at.
--
-- onboarding_meta                → per-user JSON-ish key/value for one-shot
--                                  flags that don't fit the per-item table:
--                                  product tour seen at, 8/10 celebration
--                                  shown at, checklist-panel collapsed pref.
--                                  Stored as a single row per user with named
--                                  columns so we don't need a serializer.

CREATE TABLE IF NOT EXISTS onboarding_checklist_progress (
  user_id INTEGER NOT NULL,
  item_key TEXT NOT NULL,
  completed_at DATETIME,
  skipped_at DATETIME,
  source TEXT,                       -- 'manual' | 'auto' | NULL
  PRIMARY KEY (user_id, item_key)
);

CREATE INDEX IF NOT EXISTS idx_onb_checklist_user
  ON onboarding_checklist_progress(user_id);

CREATE TABLE IF NOT EXISTS onboarding_meta (
  user_id INTEGER PRIMARY KEY,
  tour_seen_at DATETIME,
  celebration_shown_at DATETIME,
  panel_collapsed INTEGER DEFAULT 0,
  updated_at DATETIME DEFAULT (datetime('now'))
);
