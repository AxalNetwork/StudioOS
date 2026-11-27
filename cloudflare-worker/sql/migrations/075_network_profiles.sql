-- Task #1 — Mentor & partner network profiles.
-- Additive, IF NOT EXISTS. Lazy bootstrap mirror in
-- cloudflare-worker/src/services/networkProfilesSchema.ts.

CREATE TABLE IF NOT EXISTS network_profiles (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  name           TEXT NOT NULL,
  kind           TEXT NOT NULL DEFAULT 'mentor',
  role           TEXT,
  bio            TEXT,
  linkedin_url   TEXT,
  photo_r2_key   TEXT,
  skills_json    TEXT NOT NULL DEFAULT '[]',
  display_order  INTEGER NOT NULL DEFAULT 0,
  is_active      INTEGER NOT NULL DEFAULT 1,
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_network_profiles_active_order
  ON network_profiles (is_active, display_order);
