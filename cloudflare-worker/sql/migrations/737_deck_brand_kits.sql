-- D1562 (#3809, deck v2 D1): a venture's deck brand kit beyond its colours.
--
-- deck_brand_kits: one row per venture, the parts of pd7's Brand kit card the
--   landing page does not hold. The landing page's palette and logo (D898's
--   `GET /api/decks/brand-kit`) stay the base; a column set here wins.
--     display_font, body_font   a Google Font under the OFL, from the list in
--                               `services/decks/brandKit.ts` (owner decision K,
--                               A: no uploads, so no licence wording)
--     palette_json              palette roles { ground, ink, accent, secondary,
--                               highlight }, each #rrggbb
--     image_style               photo, illustration or screenshot: what the
--                               deck's generated images look like
--     reference_uids_json       up to three kept deck images of the venture the
--                               image models draw in the style of
--     logo_uid                  a kept deck image used as the logo, when the
--                               landing page has none
--   Gone with its venture (ON DELETE CASCADE).
CREATE TABLE IF NOT EXISTS deck_brand_kits (
  project_id INTEGER PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  display_font TEXT,
  body_font TEXT,
  palette_json TEXT NOT NULL DEFAULT '{}',
  image_style TEXT CHECK (image_style IS NULL OR image_style IN ('photo', 'illustration', 'screenshot')),
  reference_uids_json TEXT NOT NULL DEFAULT '[]',
  logo_uid TEXT,
  updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
