-- 687 — a member's Studio layout, one row per member and profile (D1421, #3699).
--
-- studio_layouts
--   id          row id.
--   user_id     the member the layout belongs to. Only that member reads or
--               writes it (routes/studio_layout.ts): no route takes a user id.
--   profile     which Studio home it lays out: 'founder', 'investor',
--               'advisor' or 'partner' (the Operating Partner). An admin saves
--               one per profile they preview, with ?profile=.
--   layout      a JSON array of { key, size }, in the member's order. `key` is
--               a module of services/studioModules.ts for that profile; `size`
--               is '1/3', '1/2' or 'full'. At most 12 entries. `[]` is a saved
--               choice ("I removed everything"), distinct from no row.
--   created_at, updated_at  when the row was first written and last changed.
--
-- No defaults are stored: with no row, the read answers the profile's default
-- layout from code (STUDIO_DEFAULTS), and nothing is written.
--
-- A display preference, like ai_rail_preferences (465): it is not a venture
-- write, so no activity_logs row is written for it.
--
-- Retention: a row is kept until the member resets it (POST
-- /api/studio/layout/reset deletes it), and it goes with the account
-- (ON DELETE CASCADE from users).
--
-- Additive: CREATE TABLE IF NOT EXISTS only. No BEGIN/COMMIT.
CREATE TABLE IF NOT EXISTS studio_layouts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  profile TEXT NOT NULL CHECK (profile IN ('founder','investor','advisor','partner')),
  layout TEXT NOT NULL CHECK (json_valid(layout) AND json_type(layout) = 'array'),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (user_id, profile)
);
