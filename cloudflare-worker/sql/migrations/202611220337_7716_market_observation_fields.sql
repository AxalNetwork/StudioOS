-- D7716 (#7716): what a market observation counts, where, when and from whom; whether a source's terms allow export;
-- and the metric catalogue. Additive only: nullable columns, two indexes and one new table. No CHECK on the new
-- observation fields, because a CHECK cannot be widened without rebuilding the table; the allowed values are the
-- exported lists in services/researchObservations.ts, which services/marketObservations/write.ts validates against.

ALTER TABLE research_market_observations ADD COLUMN statistical_unit TEXT;
ALTER TABLE research_market_observations ADD COLUMN scale TEXT;
ALTER TABLE research_market_observations ADD COLUMN currency TEXT;
ALTER TABLE research_market_observations ADD COLUMN price_basis TEXT;
ALTER TABLE research_market_observations ADD COLUMN industry_scheme TEXT;
ALTER TABLE research_market_observations ADD COLUMN industry_code TEXT;
ALTER TABLE research_market_observations ADD COLUMN size_band TEXT;
ALTER TABLE research_market_observations ADD COLUMN series_id TEXT;
ALTER TABLE research_market_observations ADD COLUMN supporting_passage TEXT;
ALTER TABLE research_market_observations ADD COLUMN applicability_note TEXT;
ALTER TABLE research_market_observations ADD COLUMN limitations TEXT;

-- The general query filters by metric and period, by industry code, and follows the revision chain both ways.
-- Geography, metric and period are already indexed by idx_market_obs_geo_metric_period (migration 767).
CREATE INDEX IF NOT EXISTS idx_market_obs_metric_period
  ON research_market_observations(metric_key, period);
CREATE INDEX IF NOT EXISTS idx_market_obs_industry
  ON research_market_observations(industry_code);
CREATE INDEX IF NOT EXISTS idx_market_obs_supersedes
  ON research_market_observations(supersedes_observation_id);

-- Whether the source's terms allow its values to be exported. NULL reads as not exportable.
ALTER TABLE research_market_sources ADD COLUMN export_allowed INTEGER;
-- World Bank Open Data is licensed CC BY 4.0 under its Terms of Use; its rows were already exported with attribution
-- (D7318). The other registered sources stay unset until their terms are confirmed (D7716).
UPDATE research_market_sources SET export_allowed = 1 WHERE id = 'world-bank';

CREATE TABLE IF NOT EXISTS research_market_metrics (
  metric_key TEXT NOT NULL,
  source_id TEXT NOT NULL REFERENCES research_market_sources(id),
  label TEXT NOT NULL,
  definition TEXT NOT NULL,
  unit TEXT NOT NULL,
  PRIMARY KEY (source_id, metric_key)
);
CREATE INDEX IF NOT EXISTS idx_market_metrics_metric
  ON research_market_metrics(metric_key);

-- The World Bank metrics on main (WORLD_BANK_METRICS in services/researchMarketData.ts). A later importer seeds
-- its own rows in its own migration.
INSERT OR IGNORE INTO research_market_metrics (metric_key, source_id, label, definition, unit) VALUES
('gdp_nominal_usd', 'world-bank', 'GDP (current US$)', 'Gross domestic product at purchaser''s prices, converted to US dollars at the year''s official exchange rate (World Bank indicator NY.GDP.MKTP.CD).', 'USD'),
('gdp_per_capita_usd', 'world-bank', 'GDP per capita (current US$)', 'Gross domestic product in current US dollars divided by midyear population (World Bank indicator NY.GDP.PCAP.CD).', 'USD/person'),
('real_gdp_growth_pct', 'world-bank', 'Real GDP growth', 'Annual percentage growth of gross domestic product at market prices in constant local currency (World Bank indicator NY.GDP.MKTP.KD.ZG).', 'percent'),
('inflation_cpi_pct', 'world-bank', 'Inflation, consumer prices', 'Annual percentage change in the cost to the average consumer of a basket of goods and services (World Bank indicator FP.CPI.TOTL.ZG).', 'percent'),
('population', 'world-bank', 'Population', 'Midyear estimate of all residents regardless of legal status or citizenship (World Bank indicator SP.POP.TOTL).', 'people'),
('government_debt_pct_gdp', 'world-bank', 'Central government debt', 'Gross central government debt liabilities as a share of GDP (World Bank indicator GC.DOD.TOTL.GD.ZS).', 'percent_of_GDP'),
('current_account_pct_gdp', 'world-bank', 'Current account balance', 'Net exports of goods and services, net primary income and net secondary income, as a share of GDP (World Bank indicator BN.CAB.XOKA.GD.ZS).', 'percent_of_GDP'),
('unemployment_pct', 'world-bank', 'Unemployment', 'Share of the labour force without work but available for and seeking employment, ILO modelled estimate (World Bank indicator SL.UEM.TOTL.ZS).', 'percent'),
('internet_users_pct', 'world-bank', 'Individuals using the Internet', 'Share of the population who used the Internet from any location in the last three months (World Bank indicator IT.NET.USER.ZS).', 'percent'),
('rd_intensity_pct_gdp', 'world-bank', 'Research and development expenditure', 'Gross domestic expenditure on research and development as a share of GDP (World Bank indicator GB.XPD.RSDV.GD.ZS).', 'percent_of_GDP');
