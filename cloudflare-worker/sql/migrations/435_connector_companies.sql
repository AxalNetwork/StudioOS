-- D650: a connection is enabled for named companies, never implicitly for
-- every company its owner may join later. Existing connections retain access
-- to the companies their owner belonged to when this migration runs.
CREATE TABLE IF NOT EXISTS integration_companies (
  integration_id INTEGER NOT NULL REFERENCES integrations(id) ON DELETE CASCADE,
  company_id INTEGER NOT NULL REFERENCES company_profiles(id) ON DELETE CASCADE,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (integration_id, company_id)
);
CREATE INDEX IF NOT EXISTS idx_integration_companies_company
  ON integration_companies(company_id, enabled, integration_id);

INSERT OR IGNORE INTO integration_companies (integration_id, company_id, enabled)
SELECT i.id, ucl.company_id, 1
  FROM integrations i
  JOIN user_company_links ucl ON ucl.user_id = i.user_id;

CREATE TABLE IF NOT EXISTS connector_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  company_id INTEGER NOT NULL REFERENCES company_profiles(id),
  tool TEXT NOT NULL,
  intended_use TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_connector_requests_created
  ON connector_requests(created_at DESC, id DESC);
