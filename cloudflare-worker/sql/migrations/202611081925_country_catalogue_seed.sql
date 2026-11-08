-- D5016 (#5016) — country pricing, part 3: the 49-market catalogue and its observation history.
--
-- THE MARKETS. The union of the 27 EU member states and every non-EU country in
-- the StartupBlink top-40 supplied with #5013/#5016: 40 listed + 9 EU members
-- absent from that list = 49. Each row carries only what is not an external
-- measurement: ISO 3166-1 alpha-2 code, name, a planning region, and currency
-- (ISO 4217; Bulgaria and Croatia use the euro).
--
-- NO FIGURE IS SEEDED. Population, PPP and the startup-ecosystem score and rank
-- stay NULL with status `not_recorded`. The issue's source policy requires every
-- recorded value to carry its source, reference and as-of date, and the source
-- data (the StartupBlink image, the population and PPP datasets) did not come
-- with the issue as data. A transcribed figure would be a value passed off as a
-- sourced fact. HQ records them through the observation API (or its bulk import),
-- each with its provenance. The nine EU members absent from the top-40 are told
-- apart in `strategic_note`: their score may only be recorded as `provisional`,
-- by HQ's explicit choice, never inferred.
--
-- Re-runnable: INSERT OR IGNORE, so a re-run never overwrites a profile HQ has
-- since edited.

CREATE TABLE IF NOT EXISTS country_market_observations (
  uid TEXT PRIMARY KEY,
  country_code TEXT NOT NULL,
  field TEXT NOT NULL CHECK (field IN ('population', 'ppp_gdp_per_capita', 'startup_ecosystem_score', 'startup_ecosystem_rank')),
  -- 'value' records an observation; 'status' changes a field's status (provisional / not_recorded) without a new value.
  kind TEXT NOT NULL CHECK (kind IN ('value', 'status')),
  value INTEGER CHECK (value IS NULL OR typeof(value) = 'integer'),
  status TEXT NOT NULL CHECK (status IN ('recorded', 'provisional', 'not_recorded')),
  source TEXT,
  source_ref TEXT,
  as_of TEXT,
  ingested_at TEXT NOT NULL DEFAULT (datetime('now')),
  recorded_by TEXT NOT NULL,
  reason TEXT NOT NULL CHECK (length(trim(reason)) >= 3),
  -- The profile revision this observation produced: the history reads in order, and a snapshot's
  -- `profile_revision` names the observations it was calculated from.
  profile_revision INTEGER NOT NULL,
  -- A value observation always says where it came from and when.
  CHECK (kind = 'status' OR (value IS NOT NULL AND source IS NOT NULL AND length(trim(source)) > 0 AND as_of IS NOT NULL)),
  CHECK (status <> 'not_recorded' OR value IS NULL)
);
CREATE INDEX IF NOT EXISTS idx_country_market_observations_country ON country_market_observations (country_code, field, profile_revision);

CREATE TRIGGER IF NOT EXISTS trg_country_market_observations_no_update
BEFORE UPDATE ON country_market_observations
BEGIN
  SELECT RAISE(ABORT, 'country_market_observations rows are append-only');
END;

CREATE TRIGGER IF NOT EXISTS trg_country_market_observations_no_delete
BEFORE DELETE ON country_market_observations
BEGIN
  SELECT RAISE(ABORT, 'country_market_observations rows are append-only');
END;

INSERT OR IGNORE INTO country_market_profiles (country_code, country_name, region_code, currency_code, strategic_note, updated_by) VALUES
  ('US', 'United States', 'NAM', 'USD', 'Listed in the StartupBlink top-40 supplied with #5016; its score and rank are not recorded until imported with their source.', 'seed:202611081925'),
  ('GB', 'United Kingdom', 'EUROPE', 'GBP', 'Listed in the StartupBlink top-40 supplied with #5016; its score and rank are not recorded until imported with their source.', 'seed:202611081925'),
  ('IL', 'Israel', 'MEA', 'ILS', 'Listed in the StartupBlink top-40 supplied with #5016; its score and rank are not recorded until imported with their source.', 'seed:202611081925'),
  ('CA', 'Canada', 'NAM', 'CAD', 'Listed in the StartupBlink top-40 supplied with #5016; its score and rank are not recorded until imported with their source.', 'seed:202611081925'),
  ('SG', 'Singapore', 'APAC', 'SGD', 'Listed in the StartupBlink top-40 supplied with #5016; its score and rank are not recorded until imported with their source.', 'seed:202611081925'),
  ('SE', 'Sweden', 'EU', 'SEK', 'Listed in the StartupBlink top-40 supplied with #5016; its score and rank are not recorded until imported with their source.', 'seed:202611081925'),
  ('DE', 'Germany', 'EU', 'EUR', 'Listed in the StartupBlink top-40 supplied with #5016; its score and rank are not recorded until imported with their source.', 'seed:202611081925'),
  ('FR', 'France', 'EU', 'EUR', 'Listed in the StartupBlink top-40 supplied with #5016; its score and rank are not recorded until imported with their source.', 'seed:202611081925'),
  ('NL', 'Netherlands', 'EU', 'EUR', 'Listed in the StartupBlink top-40 supplied with #5016; its score and rank are not recorded until imported with their source.', 'seed:202611081925'),
  ('CH', 'Switzerland', 'EUROPE', 'CHF', 'Listed in the StartupBlink top-40 supplied with #5016; its score and rank are not recorded until imported with their source.', 'seed:202611081925'),
  ('AU', 'Australia', 'APAC', 'AUD', 'Listed in the StartupBlink top-40 supplied with #5016; its score and rank are not recorded until imported with their source.', 'seed:202611081925'),
  ('EE', 'Estonia', 'EU', 'EUR', 'Listed in the StartupBlink top-40 supplied with #5016; its score and rank are not recorded until imported with their source.', 'seed:202611081925'),
  ('CN', 'China', 'APAC', 'CNY', 'Listed in the StartupBlink top-40 supplied with #5016; its score and rank are not recorded until imported with their source.', 'seed:202611081925'),
  ('FI', 'Finland', 'EU', 'EUR', 'Listed in the StartupBlink top-40 supplied with #5016; its score and rank are not recorded until imported with their source.', 'seed:202611081925'),
  ('ES', 'Spain', 'EU', 'EUR', 'Listed in the StartupBlink top-40 supplied with #5016; its score and rank are not recorded until imported with their source.', 'seed:202611081925'),
  ('LT', 'Lithuania', 'EU', 'EUR', 'Listed in the StartupBlink top-40 supplied with #5016; its score and rank are not recorded until imported with their source.', 'seed:202611081925'),
  ('IE', 'Ireland', 'EU', 'EUR', 'Listed in the StartupBlink top-40 supplied with #5016; its score and rank are not recorded until imported with their source.', 'seed:202611081925'),
  ('DK', 'Denmark', 'EU', 'DKK', 'Listed in the StartupBlink top-40 supplied with #5016; its score and rank are not recorded until imported with their source.', 'seed:202611081925'),
  ('IN', 'India', 'APAC', 'INR', 'Listed in the StartupBlink top-40 supplied with #5016; its score and rank are not recorded until imported with their source.', 'seed:202611081925'),
  ('KR', 'South Korea', 'APAC', 'KRW', 'Listed in the StartupBlink top-40 supplied with #5016; its score and rank are not recorded until imported with their source.', 'seed:202611081925'),
  ('JP', 'Japan', 'APAC', 'JPY', 'Listed in the StartupBlink top-40 supplied with #5016; its score and rank are not recorded until imported with their source.', 'seed:202611081925'),
  ('TW', 'Taiwan', 'APAC', 'TWD', 'Listed in the StartupBlink top-40 supplied with #5016; its score and rank are not recorded until imported with their source.', 'seed:202611081925'),
  ('AE', 'United Arab Emirates', 'MEA', 'AED', 'Listed in the StartupBlink top-40 supplied with #5016; its score and rank are not recorded until imported with their source.', 'seed:202611081925'),
  ('BE', 'Belgium', 'EU', 'EUR', 'Listed in the StartupBlink top-40 supplied with #5016; its score and rank are not recorded until imported with their source.', 'seed:202611081925'),
  ('NO', 'Norway', 'EUROPE', 'NOK', 'Listed in the StartupBlink top-40 supplied with #5016; its score and rank are not recorded until imported with their source.', 'seed:202611081925'),
  ('AT', 'Austria', 'EU', 'EUR', 'Listed in the StartupBlink top-40 supplied with #5016; its score and rank are not recorded until imported with their source.', 'seed:202611081925'),
  ('BR', 'Brazil', 'LATAM', 'BRL', 'Listed in the StartupBlink top-40 supplied with #5016; its score and rank are not recorded until imported with their source.', 'seed:202611081925'),
  ('IT', 'Italy', 'EU', 'EUR', 'Listed in the StartupBlink top-40 supplied with #5016; its score and rank are not recorded until imported with their source.', 'seed:202611081925'),
  ('PT', 'Portugal', 'EU', 'EUR', 'Listed in the StartupBlink top-40 supplied with #5016; its score and rank are not recorded until imported with their source.', 'seed:202611081925'),
  ('NZ', 'New Zealand', 'APAC', 'NZD', 'Listed in the StartupBlink top-40 supplied with #5016; its score and rank are not recorded until imported with their source.', 'seed:202611081925'),
  ('LU', 'Luxembourg', 'EU', 'EUR', 'Listed in the StartupBlink top-40 supplied with #5016; its score and rank are not recorded until imported with their source.', 'seed:202611081925'),
  ('CZ', 'Czechia', 'EU', 'CZK', 'Listed in the StartupBlink top-40 supplied with #5016; its score and rank are not recorded until imported with their source.', 'seed:202611081925'),
  ('IS', 'Iceland', 'EUROPE', 'ISK', 'Listed in the StartupBlink top-40 supplied with #5016; its score and rank are not recorded until imported with their source.', 'seed:202611081925'),
  ('PL', 'Poland', 'EU', 'PLN', 'Listed in the StartupBlink top-40 supplied with #5016; its score and rank are not recorded until imported with their source.', 'seed:202611081925'),
  ('RU', 'Russia', 'EUROPE', 'RUB', 'Listed in the StartupBlink top-40 supplied with #5016; its score and rank are not recorded until imported with their source.', 'seed:202611081925'),
  ('ID', 'Indonesia', 'APAC', 'IDR', 'Listed in the StartupBlink top-40 supplied with #5016; its score and rank are not recorded until imported with their source.', 'seed:202611081925'),
  ('BG', 'Bulgaria', 'EU', 'EUR', 'Listed in the StartupBlink top-40 supplied with #5016; its score and rank are not recorded until imported with their source.', 'seed:202611081925'),
  ('CO', 'Colombia', 'LATAM', 'COP', 'Listed in the StartupBlink top-40 supplied with #5016; its score and rank are not recorded until imported with their source.', 'seed:202611081925'),
  ('CL', 'Chile', 'LATAM', 'CLP', 'Listed in the StartupBlink top-40 supplied with #5016; its score and rank are not recorded until imported with their source.', 'seed:202611081925'),
  ('TR', 'Türkiye', 'MEA', 'TRY', 'Listed in the StartupBlink top-40 supplied with #5016; its score and rank are not recorded until imported with their source.', 'seed:202611081925'),
  ('RO', 'Romania', 'EU', 'RON', 'EU member not in the StartupBlink top-40 supplied with #5016; no ecosystem score is recorded, and none may be until HQ approves a source or a provisional proxy.', 'seed:202611081925'),
  ('MT', 'Malta', 'EU', 'EUR', 'EU member not in the StartupBlink top-40 supplied with #5016; no ecosystem score is recorded, and none may be until HQ approves a source or a provisional proxy.', 'seed:202611081925'),
  ('CY', 'Cyprus', 'EU', 'EUR', 'EU member not in the StartupBlink top-40 supplied with #5016; no ecosystem score is recorded, and none may be until HQ approves a source or a provisional proxy.', 'seed:202611081925'),
  ('HU', 'Hungary', 'EU', 'HUF', 'EU member not in the StartupBlink top-40 supplied with #5016; no ecosystem score is recorded, and none may be until HQ approves a source or a provisional proxy.', 'seed:202611081925'),
  ('GR', 'Greece', 'EU', 'EUR', 'EU member not in the StartupBlink top-40 supplied with #5016; no ecosystem score is recorded, and none may be until HQ approves a source or a provisional proxy.', 'seed:202611081925'),
  ('SI', 'Slovenia', 'EU', 'EUR', 'EU member not in the StartupBlink top-40 supplied with #5016; no ecosystem score is recorded, and none may be until HQ approves a source or a provisional proxy.', 'seed:202611081925'),
  ('SK', 'Slovakia', 'EU', 'EUR', 'EU member not in the StartupBlink top-40 supplied with #5016; no ecosystem score is recorded, and none may be until HQ approves a source or a provisional proxy.', 'seed:202611081925'),
  ('HR', 'Croatia', 'EU', 'EUR', 'EU member not in the StartupBlink top-40 supplied with #5016; no ecosystem score is recorded, and none may be until HQ approves a source or a provisional proxy.', 'seed:202611081925'),
  ('LV', 'Latvia', 'EU', 'EUR', 'EU member not in the StartupBlink top-40 supplied with #5016; no ecosystem score is recorded, and none may be until HQ approves a source or a provisional proxy.', 'seed:202611081925');

-- The v1 model #5013 states, as a DRAFT: HQ reviews it and activates it (or edits it first).
-- It is identical to `V1_MODEL_DRAFT` in services/licencePricing.ts; a test holds the two together.
INSERT OR IGNORE INTO pricing_models (
  uid, version, status, currency, reference_annual_fee_cents, reference_initial_fee_cents, default_royalty_bps,
  minimum_royalty_ratio_bps, weight_purchasing_power_bps, weight_startup_ecosystem_bps, weight_market_size_bps,
  fee_rounding_cents, normalization_json, regulatory_surcharge_json, tier_thresholds_json, note, effective_from, created_by
) VALUES (
  'pricing-model-v1-seed', 'v1', 'draft', 'EUR', 5000000, 5000000, 600, 4000, 4000, 3500, 2500, 250000,
  '{"purchasing_power":{"method":"ratio","reference":65000,"floor_ppm":300000,"cap_ppm":1600000},"startup_ecosystem":{"method":"sqrt","reference_score":30000,"floor_ppm":300000,"cap_ppm":1800000},"market_size":{"method":"log10","reference_population":50000000,"slope_ppm":250000,"floor_ppm":500000,"cap_ppm":1500000}}',
  '{"low":0,"medium":500000,"high":1500000,"very_high":3000000}',
  '[{"tier":"A","min_index_ppm":1200000},{"tier":"B","min_index_ppm":900000},{"tier":"C","min_index_ppm":600000},{"tier":"D","min_index_ppm":0}]',
  'The v1 reference model from #5013, seeded as a draft for HQ to review and activate.', '2026-12-01', 'seed:202611081925'
);
