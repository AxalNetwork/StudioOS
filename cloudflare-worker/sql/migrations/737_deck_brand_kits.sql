-- 737 — D1562 (#3809, deck builder v2 D1): the deck brand kit, beyond the
-- landing page's colours. Number given on #3809 by S1.
--
-- The venture's brand kit has lived on its newest live landing page
-- (`landing_pages`: palette, font_pairing, logos, voice; migrations 079, 399).
-- A deck needs more than that page records, so this adds the deck's own kit,
-- one row per venture, read OVER the landing page's (a value here wins; one
-- left NULL falls back to the page's):
--
--   heading_font, body_font   a pair from the fixed Google Fonts (OFL) list
--                  (`services/decks/brandKitLists.ts` BRAND_FONTS). Owner
--                  decision K = A: OFL families only; font uploads are a later
--                  task. Both or neither: the write refuses half a pair.
--   logo_url       the logo, a public https image address through the deck
--                  image guard (`routes/decks.ts` sanitizeImageUrl).
--   palette_json   the palette roles, { ground, ink, accent, secondary, muted },
--                  each a #rrggbb or absent. Legibility is the reader's job
--                  (`designSystem.ts` themeTokens), never this column's.
--   image_style    'photo', 'illustration' or 'screenshot': the style every
--                  illustration in the venture's decks is drawn in.
--
-- And its image library: at most 24 images per venture, each a public https
-- address with its alt text; at most 3 of them are the reference images
-- (`reference = 1`) the kit's art direction names. The caps are the write's
-- (`routes/deck_brand_kit.ts`); the table holds what the write let through.
--
-- Written by `PUT /api/decks/brand-kit` (one D1 batch: the kit row, then the
-- library replaced), read by `GET /api/decks/brand-kit` and
-- `POST /api/decks/:id/apply-brand`. The venture's; a support session may not
-- write it.
--
-- Additive: CREATE TABLE IF NOT EXISTS. Idempotent.

CREATE TABLE IF NOT EXISTS deck_brand_kits (
  project_id    INTEGER PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  heading_font  TEXT CHECK (heading_font IS NULL OR length(heading_font) BETWEEN 1 AND 60),
  body_font     TEXT CHECK (body_font IS NULL OR length(body_font) BETWEEN 1 AND 60),
  logo_url      TEXT CHECK (logo_url IS NULL OR (length(logo_url) <= 1000 AND logo_url LIKE 'https://%')),
  palette_json  TEXT CHECK (palette_json IS NULL OR (json_valid(palette_json) AND json_type(palette_json) = 'object')),
  image_style   TEXT CHECK (image_style IS NULL OR image_style IN ('photo', 'illustration', 'screenshot')),
  updated_by    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK ((heading_font IS NULL) = (body_font IS NULL))
);

CREATE TABLE IF NOT EXISTS deck_brand_kit_images (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id  INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  url         TEXT NOT NULL CHECK (length(url) <= 1000 AND url LIKE 'https://%'),
  alt         TEXT CHECK (alt IS NULL OR length(alt) <= 200),
  reference   INTEGER NOT NULL DEFAULT 0 CHECK (reference IN (0, 1)),
  added_by    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  added_at    TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (project_id, url)
);

CREATE INDEX IF NOT EXISTS idx_deck_brand_kit_images_project ON deck_brand_kit_images(project_id, id);
