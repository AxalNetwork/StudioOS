-- D1572 (#3819, deck v2 D11): brand locks and a venture's own layouts.
--
-- deck_brand_locks: one row per locked part of a venture's deck brand kit
--   (migration 737). A part is the font pair, the palette roles or the logo.
--   Only the venture's admin (its owner) locks or unlocks a part; while a part
--   is locked a save that changes it is refused, naming who locked it.
--   No row means the part is not locked. Gone with its venture.
CREATE TABLE IF NOT EXISTS deck_brand_locks (
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  part TEXT NOT NULL CHECK (part IN ('fonts', 'palette', 'logo')),
  locked_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  locked_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (project_id, part)
);

-- deck_custom_layouts: a venture's own structures, imported from a .pptx
--   template (pd30, "Save as your layouts") and offered beside The Grid's
--   (pd10, "YOUR LAYOUTS · FROM <file>.PPTX"). blocks_json is the layout's
--   areas on whole cells of the 12 × 6 grid, each { kind, c1, c2, r1, r2 }.
--   Only layouts that placed on whole cells are saved. Gone with its venture.
CREATE TABLE IF NOT EXISTS deck_custom_layouts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  source_name TEXT,
  blocks_json TEXT NOT NULL,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_deck_custom_layouts_project ON deck_custom_layouts (project_id, id);
