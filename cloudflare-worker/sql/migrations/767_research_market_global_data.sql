-- #7318 Research Markets: append-only, source-backed global observations.
-- Provider revisions are inserted as new rows; previous vintages are retained.
CREATE TABLE IF NOT EXISTS research_market_sources (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  source_url TEXT NOT NULL,
  dataset_or_edition TEXT NOT NULL,
  methodology_url TEXT,
  license_or_usage_note TEXT,
  refresh_policy TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0,1)),
  last_success_at TEXT,
  last_attempt_at TEXT,
  last_error TEXT
);

CREATE TABLE IF NOT EXISTS research_market_observations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_id TEXT NOT NULL REFERENCES research_market_sources(id),
  metric_key TEXT NOT NULL,
  metric_label TEXT NOT NULL,
  geography_type TEXT NOT NULL CHECK (geography_type IN ('country','region','city','ecosystem')),
  geography_code TEXT NOT NULL,
  period TEXT NOT NULL,
  value REAL,
  unit TEXT NOT NULL,
  observation_status TEXT NOT NULL CHECK (observation_status IN ('actual','estimate','forecast','axal_derived','unspecified')),
  published_at TEXT,
  retrieved_at TEXT NOT NULL,
  confidence TEXT NOT NULL DEFAULT 'source_reported',
  source_observation_key TEXT NOT NULL,
  vintage TEXT NOT NULL,
  supersedes_observation_id INTEGER REFERENCES research_market_observations(id),
  UNIQUE(source_id, source_observation_key, vintage)
);
CREATE INDEX IF NOT EXISTS idx_market_obs_geo_metric_period
  ON research_market_observations(geography_code, metric_key, period DESC, retrieved_at DESC);
CREATE INDEX IF NOT EXISTS idx_market_obs_source_vintage
  ON research_market_observations(source_id, vintage, geography_code);

CREATE TABLE IF NOT EXISTS research_market_ingestion_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_id TEXT NOT NULL REFERENCES research_market_sources(id),
  vintage TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  status TEXT NOT NULL CHECK (status IN ('running','succeeded','failed','partial')),
  rows_seen INTEGER NOT NULL DEFAULT 0,
  rows_inserted INTEGER NOT NULL DEFAULT 0,
  rows_unchanged INTEGER NOT NULL DEFAULT 0,
  error TEXT
);
CREATE INDEX IF NOT EXISTS idx_market_runs_source_started
  ON research_market_ingestion_runs(source_id, started_at DESC);

INSERT OR IGNORE INTO research_market_sources
(id,name,source_url,dataset_or_edition,methodology_url,license_or_usage_note,refresh_policy,enabled)
VALUES
('world-bank','World Bank Open Data','https://api.worldbank.org/v2','World Development Indicators','https://datahelpdesk.worldbank.org/knowledgebase/articles/906531-methodologies','World Bank API terms apply; retain source attribution.','monthly',1),
('imf-weo','IMF World Economic Outlook','https://www.imf.org/en/Publications/WEO','WEO October 2026','https://www.imf.org/en/Publications/WEO/weo-database/2026/October','Disabled until Axal confirms redistribution/reuse terms for the selected delivery channel.','april_october',0),
('wipo-gii','WIPO Global Innovation Index','https://www.wipo.int/global_innovation_index/','Global Innovation Index 2026','https://www.wipo.int/global_innovation_index/','Ingest only fields whose reuse terms permit persistence/display; preserve edition.','annual',0),
('oecd','OECD Data','https://data-explorer.oecd.org/','OECD Data Explorer','https://www.oecd.org/en/about/legal/terms-conditions.html','Provider terms apply.','monthly',0),
('eurostat','Eurostat','https://ec.europa.eu/eurostat/','Eurostat','https://ec.europa.eu/eurostat/web/main/help/methodology','European Commission reuse terms apply.','monthly',0),
('unctad','UNCTADstat','https://unctadstat.unctad.org/','UNCTADstat','https://unctadstat.unctad.org/','UNCTAD terms apply.','quarterly',0);
