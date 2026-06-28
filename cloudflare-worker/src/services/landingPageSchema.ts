/**
 * Task #4 — Lazy bootstrap for the brand-kit columns on landing_pages.
 *
 * Migration 079 is the canonical apply path, but recent migrations have
 * a habit of landing un-applied on prod, so both the brand route (writer)
 * and the Spin-Out deck builder (reader) self-heal by adding the columns
 * on the cold path. SQLite has no `ADD COLUMN IF NOT EXISTS`, so each
 * ALTER is wrapped in try/catch — a duplicate column (or a not-yet-created
 * table) throws and is swallowed.
 */
import type { Env } from '../types';

let _ready = false;

export async function ensureLandingPageBrandKitColumns(env: Env): Promise<void> {
  if (_ready) return;
  const alters = [
    `ALTER TABLE landing_pages ADD COLUMN palette_bg TEXT`,
    `ALTER TABLE landing_pages ADD COLUMN palette_ink TEXT`,
    `ALTER TABLE landing_pages ADD COLUMN font_pairing TEXT`,
    `ALTER TABLE landing_pages ADD COLUMN palette_secondary TEXT`,
    `ALTER TABLE landing_pages ADD COLUMN palette_accent TEXT`,
    `ALTER TABLE landing_pages ADD COLUMN logo_asset_id TEXT`,
    // Task #4 — audience segmentation + preview token
    `ALTER TABLE landing_pages ADD COLUMN preview_token TEXT`,
    `ALTER TABLE landing_pages ADD COLUMN audience_customer_headline TEXT`,
    `ALTER TABLE landing_pages ADD COLUMN audience_customer_body TEXT`,
    `ALTER TABLE landing_pages ADD COLUMN audience_customer_cta TEXT`,
    `ALTER TABLE landing_pages ADD COLUMN audience_partner_headline TEXT`,
    `ALTER TABLE landing_pages ADD COLUMN audience_partner_body TEXT`,
    `ALTER TABLE landing_pages ADD COLUMN audience_partner_cta TEXT`,
    `ALTER TABLE landing_pages ADD COLUMN audience_investor_headline TEXT`,
    `ALTER TABLE landing_pages ADD COLUMN audience_investor_body TEXT`,
    `ALTER TABLE landing_pages ADD COLUMN audience_investor_cta TEXT`,
    // Task #3 (audience-first) — remaining 3 audiences' per-audience copy.
    `ALTER TABLE landing_pages ADD COLUMN audience_advisor_headline TEXT`,
    `ALTER TABLE landing_pages ADD COLUMN audience_advisor_body TEXT`,
    `ALTER TABLE landing_pages ADD COLUMN audience_advisor_cta TEXT`,
    `ALTER TABLE landing_pages ADD COLUMN audience_mentor_headline TEXT`,
    `ALTER TABLE landing_pages ADD COLUMN audience_mentor_body TEXT`,
    `ALTER TABLE landing_pages ADD COLUMN audience_mentor_cta TEXT`,
    `ALTER TABLE landing_pages ADD COLUMN audience_cofounder_headline TEXT`,
    `ALTER TABLE landing_pages ADD COLUMN audience_cofounder_body TEXT`,
    `ALTER TABLE landing_pages ADD COLUMN audience_cofounder_cta TEXT`,
    `ALTER TABLE waitlist_signups ADD COLUMN audience TEXT`,
    // Task #5 — landing page template library
    `ALTER TABLE landing_pages ADD COLUMN template TEXT`,
    `ALTER TABLE landing_pages ADD COLUMN hero_media_url TEXT`,
    `ALTER TABLE landing_pages ADD COLUMN product_screenshot_url TEXT`,
    // Audience-first flow — primary page audience (full 6-value taxonomy),
    // goal, and catalog template id. Separate from the per-audience copy
    // columns above and from the narrow waitlist audience.
    `ALTER TABLE landing_pages ADD COLUMN audience TEXT`,
    `ALTER TABLE landing_pages ADD COLUMN goal TEXT`,
    `ALTER TABLE landing_pages ADD COLUMN template_kit TEXT`,
    // Task #3 — per-template editable content blocks (JSON).
    `ALTER TABLE landing_pages ADD COLUMN content_json TEXT`,
  ];
  for (const s of alters) {
    try { await env.DB.prepare(s).run(); } catch { /* column exists / table absent */ }
  }
  // D1 has no CREATE INDEX IF NOT EXISTS on some versions; catch and swallow.
  for (const idx of [
    `CREATE INDEX IF NOT EXISTS idx_landing_preview_token ON landing_pages(preview_token)`,
    `CREATE INDEX IF NOT EXISTS idx_waitlist_audience ON waitlist_signups(project_id, audience)`,
  ]) {
    try { await env.DB.prepare(idx).run(); } catch { /* already exists */ }
  }
  _ready = true;
}
