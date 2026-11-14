-- Task #2 (AU) — Admin Publication Exports.
--
-- One row per Axal-VC branded MI publication (draft → published). Render
-- artifacts (PDF/CSV/PNG) live in the PUBLICATIONS R2 bucket and are
-- referenced via short-lived (24h) HMAC-signed Worker download URLs;
-- we do NOT persist any direct R2 URL here.
--
-- The render and publish endpoints additionally write to the existing
-- `admin_audit_log` table (no schema change there).
--
-- IDEMPOTENCY: every CREATE is `IF NOT EXISTS`. No BEGIN/COMMIT — D1
-- raw SQL rejects explicit transactions; each statement is implicitly
-- transacted by the runtime.

CREATE TABLE IF NOT EXISTS admin_publications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE,                -- public read URL slug
  title TEXT NOT NULL,
  subtitle TEXT,
  audience TEXT NOT NULL DEFAULT 'internal',-- internal | lp | founder | media | partners
  section TEXT NOT NULL,                    -- MI section key (sentiment / sector_heat / talc / market_pulse / …)
  filters_json TEXT NOT NULL DEFAULT '{}',  -- arbitrary section filter blob
  summary_text TEXT NOT NULL DEFAULT '',    -- AI-drafted (or admin-edited) headline summary
  summary_human_edited INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'draft',     -- draft | published
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  published_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_admin_publications_slug
  ON admin_publications(slug);
CREATE INDEX IF NOT EXISTS idx_admin_publications_status_created
  ON admin_publications(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_publications_created_by
  ON admin_publications(created_by, created_at DESC);
