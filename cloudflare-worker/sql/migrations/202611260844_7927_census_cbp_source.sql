-- D7927 (#7927): the U.S. Census Bureau County Business Patterns source (national level) and its three metrics. Data
-- only: one source row and three catalogue rows. No observation is seeded; rows arrive only through the operator import
-- (D7709). The source lands DISABLED: #7927 authorises no live source activation, so an owner enables it when they
-- choose. export_allowed stays unset (D7716: export is a per-source owner decision).
-- Terms read 2026-11-26: the CBP dataset metadata (https://api.census.gov/data/2023/cbp.json) gives the licence
-- https://creativecommons.org/publicdomain/zero/1.0/ (CC0); the Census Data API terms of service
-- (https://www.census.gov/data/developers/about/terms-of-service.html, page last revised 2026-04-14) ask that content
-- not be modified while still claimed as the Census Bureau's, and that no endorsement be implied.
-- forward-fix: cloudflare-worker/sql/forward-fixes/202611260844_7927_census_cbp_source.fix.sql
INSERT OR IGNORE INTO research_market_sources
(id, name, source_url, dataset_or_edition, methodology_url, license_or_usage_note, refresh_policy, enabled)
VALUES
('census-cbp', 'U.S. Census Bureau County Business Patterns (national)',
 'https://www2.census.gov/programs-surveys/cbp/datasets/',
 'County Business Patterns, national file cbp<yy>us.txt, reference years 2018 to 2023, NAICS 2017, all legal forms of organization',
 'https://www.census.gov/programs-surveys/cbp/technical-documentation/methodology.html',
 'Source: U.S. Census Bureau, County Business Patterns, national file for the reference year, retrieved on each row''s retrieval date. Public domain (CC0 1.0, per the dataset metadata read 2026-11-26). Values are not modified; NAICS codes are written without the file''s padding. This product is not endorsed or certified by the Census Bureau. Limitations: counts are establishments with paid employees, not companies or customers; the self-employed, private households, railroad, agricultural production and most government employees are excluded; values carry noise infusion for disclosure avoidance.',
 'annual', 0);

INSERT OR IGNORE INTO research_market_metrics (metric_key, source_id, label, definition, unit) VALUES
('cbp_establishments', 'census-cbp', 'Number of establishments', 'Number of establishments with paid employees in a NAICS 2017 industry in the United States (50 states and DC) for a reference year (County Business Patterns, field EST). An establishment is a single physical location, not a company or a customer.', 'establishments'),
('cbp_employees', 'census-cbp', 'Paid employees, pay period including March 12', 'Paid employees of those establishments in the pay period including March 12 of the reference year (County Business Patterns, field EMP, with noise infusion).', 'persons'),
('cbp_annual_payroll', 'census-cbp', 'Annual payroll ($1,000)', 'Annual payroll of those establishments in thousands of U.S. dollars at current prices (County Business Patterns, field AP, with noise infusion). Payroll paid, not revenue or spending.', 'USD');
