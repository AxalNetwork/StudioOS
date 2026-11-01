-- 725 — D1535 (#3782, deck v2 B6): the deck template store behind the Pitch
-- deck studio Gallery and "Save as my template".
--
-- A template is structure, theme and decor with bracketed placeholders, never
-- a venture's words or figures. HQ's templates (`scope = 'hq'`, no owner) are
-- seeded by #3876's content; a member's own (`scope = 'user'`) are saved from
-- one of their decks with text and figures removed.
--
-- `structure_json` is #3876's H14 object (`deck_template/1`); `theme_json` its
-- theme. The Gallery's filter metadata are columns, so the list filters in SQL:
-- name, description, stage, audience_tags (a JSON list of New deck's seven
-- audiences), deck_audience, style, swatch and card_count. `provenance_json`
-- records the origin and that no third-party template was copied.
--
-- Additive: one new table and its indexes. Idempotent.

CREATE TABLE IF NOT EXISTS deck_templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  scope TEXT NOT NULL CHECK (scope IN ('hq', 'user')),
  owner_id INTEGER REFERENCES users(id),
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 40),
  description TEXT CHECK (description IS NULL OR length(description) <= 140),
  stage TEXT CHECK (stage IS NULL OR stage IN ('pre_seed', 'seed', 'series_a', 'series_b_plus')),
  audience_tags TEXT NOT NULL DEFAULT '[]',
  deck_audience TEXT,
  style TEXT CHECK (style IS NULL OR style IN ('editorial', 'bold', 'minimal')),
  swatch TEXT,
  card_count INTEGER NOT NULL CHECK (card_count BETWEEN 1 AND 40),
  structure_json TEXT NOT NULL,
  theme_json TEXT,
  provenance_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK ((scope = 'hq' AND owner_id IS NULL) OR (scope = 'user' AND owner_id IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS idx_deck_templates_gallery ON deck_templates (scope, stage, style);
CREATE INDEX IF NOT EXISTS idx_deck_templates_owner ON deck_templates (owner_id, created_at);
