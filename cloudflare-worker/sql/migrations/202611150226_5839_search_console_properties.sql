-- D5839 (#5839) — the one Search Console property each venture reads.
--
-- One new table and one index; no existing table changes. A row binds a
-- venture (`project_id` UNIQUE) to the property a founder chose, through that
-- founder's own `google_search_console` connection. `site_url` is Google's
-- identifier exactly as `sites.list` returned it: `sc-domain:example.com` for
-- a domain property, `https://example.com/` for a URL-prefix property.
-- `permission_level` is the level Google reported at selection or at the last
-- check (`siteOwner`, `siteFullUser`, `siteRestrictedUser`); `access_state`
-- turns `lost` when a later check finds the property unusable or gone.
-- The provider's disconnect deletes the rows; `integration_id` cascades as a
-- backstop. No token or Google principal is stored here.
CREATE TABLE IF NOT EXISTS search_console_properties (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  integration_id INTEGER NOT NULL REFERENCES integrations(id) ON DELETE CASCADE,
  project_id INTEGER NOT NULL UNIQUE REFERENCES projects(id) ON DELETE CASCADE,
  site_url TEXT NOT NULL,
  property_kind TEXT NOT NULL CHECK (property_kind IN ('domain', 'url_prefix')),
  permission_level TEXT NOT NULL CHECK (permission_level IN ('siteOwner', 'siteFullUser', 'siteRestrictedUser')),
  access_state TEXT NOT NULL DEFAULT 'ok' CHECK (access_state IN ('ok', 'lost')),
  checked_at TEXT NOT NULL DEFAULT (datetime('now')),
  bound_by INTEGER NOT NULL REFERENCES users(id),
  bound_at TEXT NOT NULL DEFAULT (datetime('now')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_search_console_properties_integration ON search_console_properties (integration_id);
