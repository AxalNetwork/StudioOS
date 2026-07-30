-- Branded multi-page sites & templates.
--   1. brand_sites — one editable, human-readable startup slug per project,
--      backfilled from each project's existing (globally unique) landing slug
--      so the backfill can never collide.
--   2. landing_pages rebuild — SQLite cannot drop a column-level UNIQUE, so
--      the one-page-per-project limit (project_id UNIQUE) is removed by the
--      full table-rebuild dance. Adds page_slug (unique per project); keeps
--      the legacy global slug so /landing/:slug, waitlist, and view pings
--      keep working unchanged. Column list matches prod PRAGMA table_info
--      exactly (47 cols) — a missing column aborts the deploy loudly.
--   3. brand_custom_templates — founder-saved reusable page designs.
-- Forward-only; applied once via the schema_migrations ledger.

CREATE TABLE IF NOT EXISTS brand_sites (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL UNIQUE,
  slug TEXT NOT NULL UNIQUE,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

INSERT OR IGNORE INTO brand_sites (project_id, slug)
  SELECT project_id, slug FROM landing_pages;

CREATE TABLE landing_pages_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  page_slug TEXT NOT NULL DEFAULT 'home',
  name TEXT NOT NULL,
  tagline TEXT,
  headline TEXT,
  subheadline TEXT,
  cta_text TEXT DEFAULT 'Join the waitlist',
  logo_url TEXT,
  logo_svg TEXT,
  theme_color TEXT DEFAULT '#7c3aed',
  published INTEGER DEFAULT 0,
  views_count INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  palette_bg TEXT,
  palette_ink TEXT,
  font_pairing TEXT,
  palette_secondary TEXT,
  palette_accent TEXT,
  logo_asset_id TEXT,
  preview_token TEXT,
  audience_customer_headline TEXT,
  audience_customer_body TEXT,
  audience_customer_cta TEXT,
  audience_partner_headline TEXT,
  audience_partner_body TEXT,
  audience_partner_cta TEXT,
  audience_investor_headline TEXT,
  audience_investor_body TEXT,
  audience_investor_cta TEXT,
  template TEXT,
  hero_media_url TEXT,
  product_screenshot_url TEXT,
  audience_advisor_headline TEXT,
  audience_advisor_body TEXT,
  audience_advisor_cta TEXT,
  audience_mentor_headline TEXT,
  audience_mentor_body TEXT,
  audience_mentor_cta TEXT,
  audience_cofounder_headline TEXT,
  audience_cofounder_body TEXT,
  audience_cofounder_cta TEXT,
  audience TEXT,
  goal TEXT,
  template_kit TEXT,
  content_json TEXT
);

INSERT INTO landing_pages_new (
  id, project_id, slug, page_slug, name, tagline, headline, subheadline, cta_text,
  logo_url, logo_svg, theme_color, published, views_count, created_at, updated_at,
  palette_bg, palette_ink, font_pairing, palette_secondary, palette_accent,
  logo_asset_id, preview_token,
  audience_customer_headline, audience_customer_body, audience_customer_cta,
  audience_partner_headline, audience_partner_body, audience_partner_cta,
  audience_investor_headline, audience_investor_body, audience_investor_cta,
  template, hero_media_url, product_screenshot_url,
  audience_advisor_headline, audience_advisor_body, audience_advisor_cta,
  audience_mentor_headline, audience_mentor_body, audience_mentor_cta,
  audience_cofounder_headline, audience_cofounder_body, audience_cofounder_cta,
  audience, goal, template_kit, content_json
)
SELECT
  id, project_id, slug, 'home', name, tagline, headline, subheadline, cta_text,
  logo_url, logo_svg, theme_color, published, views_count, created_at, updated_at,
  palette_bg, palette_ink, font_pairing, palette_secondary, palette_accent,
  logo_asset_id, preview_token,
  audience_customer_headline, audience_customer_body, audience_customer_cta,
  audience_partner_headline, audience_partner_body, audience_partner_cta,
  audience_investor_headline, audience_investor_body, audience_investor_cta,
  template, hero_media_url, product_screenshot_url,
  audience_advisor_headline, audience_advisor_body, audience_advisor_cta,
  audience_mentor_headline, audience_mentor_body, audience_mentor_cta,
  audience_cofounder_headline, audience_cofounder_body, audience_cofounder_cta,
  audience, goal, template_kit, content_json
FROM landing_pages;

DROP TABLE landing_pages;
ALTER TABLE landing_pages_new RENAME TO landing_pages;

CREATE INDEX IF NOT EXISTS idx_landing_slug ON landing_pages(slug);
CREATE INDEX IF NOT EXISTS idx_landing_preview_token ON landing_pages(preview_token);
CREATE UNIQUE INDEX IF NOT EXISTS idx_landing_project_page ON landing_pages(project_id, page_slug);

CREATE TABLE IF NOT EXISTS brand_custom_templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  snapshot_json TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_brand_custom_templates_user ON brand_custom_templates(user_id);
