-- D5014 (#5014) — country-adjusted franchise pricing, part 1: the durable model.
--
-- A RECOMMENDATION LAYER, NOT A LEDGER. Nothing here is a licence term. A country
-- profile and an active pricing model produce a recommendation (#5015); HQ
-- accepts or overrides it (#5017), and the accepted values still go through the
-- revision-safe licence terms write in `admin_licences_terms.ts`. So this
-- migration only adds tables: no existing licence, invoice or program-grant row
-- is read, written or altered, and every statement is re-runnable.
--
-- NUMBERS. Money is integer minor units, rates are basis points, and every
-- factor or index is a fixed-point integer in millionths (1.0 = 1000000). The
-- issue sketched NUMERIC for PPP and the startup score; they are integers here
-- so no binary float is ever persisted: PPP is whole international dollars, the
-- startup score is thousandths of a point (236.512 = 236512).
--
-- UNKNOWN IS NOT ZERO. Every external value is NULL until recorded, and carries
-- its own status (`recorded | provisional | not_recorded`), source, reference
-- and as-of date, so a missing figure can never be read as a zero.

-- One current profile per ISO 3166-1 alpha-2 country. Its history lives in the
-- snapshots that recommendations froze (below), and in the observation history
-- #5016 adds; this row is only "what HQ holds today".
CREATE TABLE IF NOT EXISTS country_market_profiles (
  country_code TEXT PRIMARY KEY CHECK (length(country_code) = 2 AND country_code = upper(country_code) AND country_code GLOB '[A-Z][A-Z]'),
  country_name TEXT NOT NULL,
  region_code TEXT,
  currency_code TEXT CHECK (currency_code IS NULL OR (length(currency_code) = 3 AND currency_code = upper(currency_code))),

  population INTEGER CHECK (population IS NULL OR (typeof(population) = 'integer' AND population > 0)),
  population_status TEXT NOT NULL DEFAULT 'not_recorded' CHECK (population_status IN ('recorded', 'provisional', 'not_recorded')),
  population_source TEXT,
  population_source_ref TEXT,
  population_as_of TEXT,

  -- GDP per capita at purchasing-power parity, whole international dollars.
  ppp_gdp_per_capita INTEGER CHECK (ppp_gdp_per_capita IS NULL OR (typeof(ppp_gdp_per_capita) = 'integer' AND ppp_gdp_per_capita > 0)),
  ppp_status TEXT NOT NULL DEFAULT 'not_recorded' CHECK (ppp_status IN ('recorded', 'provisional', 'not_recorded')),
  ppp_source TEXT,
  ppp_source_ref TEXT,
  ppp_as_of TEXT,

  -- A startup-ecosystem score in thousandths of a point, and its rank.
  startup_ecosystem_score INTEGER CHECK (startup_ecosystem_score IS NULL OR (typeof(startup_ecosystem_score) = 'integer' AND startup_ecosystem_score >= 0)),
  startup_ecosystem_rank INTEGER CHECK (startup_ecosystem_rank IS NULL OR (typeof(startup_ecosystem_rank) = 'integer' AND startup_ecosystem_rank > 0)),
  startup_score_status TEXT NOT NULL DEFAULT 'not_recorded' CHECK (startup_score_status IN ('recorded', 'provisional', 'not_recorded')),
  startup_source TEXT,
  startup_source_ref TEXT,
  startup_as_of TEXT,

  -- Commercial planning metadata, never a legal determination.
  regulatory_class TEXT CHECK (regulatory_class IS NULL OR regulatory_class IN ('low', 'medium', 'high', 'very_high')),
  regulatory_note TEXT,
  strategic_note TEXT,

  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_by TEXT,
  revision INTEGER NOT NULL DEFAULT 0,

  -- A value cannot be "recorded" or "provisional" without one: a status with a
  -- NULL value is the one way an unknown could pass for a fact.
  CHECK (population_status = 'not_recorded' OR population IS NOT NULL),
  CHECK (ppp_status = 'not_recorded' OR ppp_gdp_per_capita IS NOT NULL),
  CHECK (startup_score_status = 'not_recorded' OR startup_ecosystem_score IS NOT NULL)
);

-- Versioned pricing models. A draft may be edited; an active or retired model's
-- calculation fields never change (the trigger below), so a recommendation that
-- names a model version can always be recalculated exactly. Changing the model
-- means publishing a new version.
CREATE TABLE IF NOT EXISTS pricing_models (
  uid TEXT PRIMARY KEY,
  version TEXT UNIQUE NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'retired')),
  currency TEXT NOT NULL DEFAULT 'EUR' CHECK (length(currency) = 3 AND currency = upper(currency)),
  reference_annual_fee_cents INTEGER NOT NULL CHECK (typeof(reference_annual_fee_cents) = 'integer' AND reference_annual_fee_cents > 0),
  reference_initial_fee_cents INTEGER NOT NULL CHECK (typeof(reference_initial_fee_cents) = 'integer' AND reference_initial_fee_cents >= 0),
  default_royalty_bps INTEGER NOT NULL CHECK (typeof(default_royalty_bps) = 'integer' AND default_royalty_bps BETWEEN 0 AND 10000),
  minimum_royalty_ratio_bps INTEGER NOT NULL CHECK (typeof(minimum_royalty_ratio_bps) = 'integer' AND minimum_royalty_ratio_bps BETWEEN 0 AND 10000),
  weight_purchasing_power_bps INTEGER NOT NULL CHECK (typeof(weight_purchasing_power_bps) = 'integer' AND weight_purchasing_power_bps BETWEEN 0 AND 10000),
  weight_startup_ecosystem_bps INTEGER NOT NULL CHECK (typeof(weight_startup_ecosystem_bps) = 'integer' AND weight_startup_ecosystem_bps BETWEEN 0 AND 10000),
  weight_market_size_bps INTEGER NOT NULL CHECK (typeof(weight_market_size_bps) = 'integer' AND weight_market_size_bps BETWEEN 0 AND 10000),
  -- Recommended fees round to this commercial increment (EUR 2,500 by default).
  fee_rounding_cents INTEGER NOT NULL DEFAULT 250000 CHECK (typeof(fee_rounding_cents) = 'integer' AND fee_rounding_cents > 0),
  normalization_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(normalization_json)),
  regulatory_surcharge_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(regulatory_surcharge_json)),
  tier_thresholds_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(tier_thresholds_json)),
  note TEXT,
  effective_from TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  created_by TEXT,
  activated_at TEXT,
  activated_by TEXT,
  retired_at TEXT,
  CHECK (weight_purchasing_power_bps + weight_startup_ecosystem_bps + weight_market_size_bps = 10000)
);
-- One active model at a time: "the active model" is never ambiguous.
CREATE UNIQUE INDEX IF NOT EXISTS idx_pricing_models_one_active ON pricing_models (status) WHERE status = 'active';

-- An active or retired model's calculation fields are frozen. Only the status
-- may move on (active → retired), with its own timestamps.
CREATE TRIGGER IF NOT EXISTS trg_pricing_models_frozen
BEFORE UPDATE ON pricing_models
WHEN OLD.status <> 'draft' AND (
  NEW.uid IS NOT OLD.uid OR NEW.version IS NOT OLD.version OR NEW.currency IS NOT OLD.currency
  OR NEW.reference_annual_fee_cents IS NOT OLD.reference_annual_fee_cents
  OR NEW.reference_initial_fee_cents IS NOT OLD.reference_initial_fee_cents
  OR NEW.default_royalty_bps IS NOT OLD.default_royalty_bps
  OR NEW.minimum_royalty_ratio_bps IS NOT OLD.minimum_royalty_ratio_bps
  OR NEW.weight_purchasing_power_bps IS NOT OLD.weight_purchasing_power_bps
  OR NEW.weight_startup_ecosystem_bps IS NOT OLD.weight_startup_ecosystem_bps
  OR NEW.weight_market_size_bps IS NOT OLD.weight_market_size_bps
  OR NEW.fee_rounding_cents IS NOT OLD.fee_rounding_cents
  OR NEW.normalization_json IS NOT OLD.normalization_json
  OR NEW.regulatory_surcharge_json IS NOT OLD.regulatory_surcharge_json
  OR NEW.tier_thresholds_json IS NOT OLD.tier_thresholds_json
  OR NEW.effective_from IS NOT OLD.effective_from
  OR (OLD.status = 'retired' AND NEW.status <> 'retired')
  OR (OLD.status = 'active' AND NEW.status = 'draft')
)
BEGIN
  SELECT RAISE(ABORT, 'pricing_model_immutable');
END;

CREATE TRIGGER IF NOT EXISTS trg_pricing_models_no_delete
BEFORE DELETE ON pricing_models
WHEN OLD.status <> 'draft'
BEGIN
  SELECT RAISE(ABORT, 'pricing_model_immutable');
END;

-- The market inputs a recommendation was calculated from, frozen. Append-only:
-- a later country-data or model change makes a NEW snapshot and never touches
-- this one, so every past recommendation stays reproducible.
CREATE TABLE IF NOT EXISTS country_pricing_snapshots (
  uid TEXT PRIMARY KEY,
  country_code TEXT NOT NULL,
  pricing_model_uid TEXT NOT NULL REFERENCES pricing_models(uid),
  pricing_model_version TEXT NOT NULL,

  population INTEGER,
  population_status TEXT NOT NULL,
  population_source TEXT,
  population_as_of TEXT,
  ppp_gdp_per_capita INTEGER,
  ppp_status TEXT NOT NULL,
  ppp_source TEXT,
  ppp_as_of TEXT,
  startup_ecosystem_score INTEGER,
  startup_ecosystem_rank INTEGER,
  startup_score_status TEXT NOT NULL,
  startup_source TEXT,
  startup_as_of TEXT,
  regulatory_class TEXT,
  profile_revision INTEGER NOT NULL,

  -- Millionths. NULL when the input it depends on was not recorded.
  purchasing_power_factor INTEGER CHECK (purchasing_power_factor IS NULL OR typeof(purchasing_power_factor) = 'integer'),
  startup_ecosystem_factor INTEGER CHECK (startup_ecosystem_factor IS NULL OR typeof(startup_ecosystem_factor) = 'integer'),
  market_size_factor INTEGER CHECK (market_size_factor IS NULL OR typeof(market_size_factor) = 'integer'),
  country_index INTEGER CHECK (country_index IS NULL OR typeof(country_index) = 'integer'),
  tier TEXT,
  complete INTEGER NOT NULL CHECK (complete IN (0, 1)),
  provisional_inputs_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(provisional_inputs_json)),
  missing_inputs_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(missing_inputs_json)),

  recommended_initial_fee_cents INTEGER CHECK (recommended_initial_fee_cents IS NULL OR typeof(recommended_initial_fee_cents) = 'integer'),
  recommended_annual_fee_cents INTEGER CHECK (recommended_annual_fee_cents IS NULL OR typeof(recommended_annual_fee_cents) = 'integer'),
  recommended_royalty_bps INTEGER CHECK (recommended_royalty_bps IS NULL OR typeof(recommended_royalty_bps) = 'integer'),
  recommended_minimum_royalty_cents INTEGER CHECK (recommended_minimum_royalty_cents IS NULL OR typeof(recommended_minimum_royalty_cents) = 'integer'),
  recommended_regulatory_surcharge_cents INTEGER CHECK (recommended_regulatory_surcharge_cents IS NULL OR typeof(recommended_regulatory_surcharge_cents) = 'integer'),
  currency TEXT NOT NULL,
  trace_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(trace_json)),

  source_digest TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  created_by TEXT
);
CREATE INDEX IF NOT EXISTS idx_country_pricing_snapshots_country ON country_pricing_snapshots (country_code, created_at);
CREATE INDEX IF NOT EXISTS idx_country_pricing_snapshots_digest ON country_pricing_snapshots (source_digest);

CREATE TRIGGER IF NOT EXISTS trg_country_pricing_snapshots_no_update
BEFORE UPDATE ON country_pricing_snapshots
BEGIN
  SELECT RAISE(ABORT, 'country_pricing_snapshots rows are append-only');
END;

CREATE TRIGGER IF NOT EXISTS trg_country_pricing_snapshots_no_delete
BEFORE DELETE ON country_pricing_snapshots
BEGIN
  SELECT RAISE(ABORT, 'country_pricing_snapshots rows are append-only');
END;

-- What HQ did with a recommendation for a licence: accepted it, or overrode it
-- and said why. An audit row, never a substitute for `territory_licences`:
-- accepted core terms still go through the licence terms write (#5017).
CREATE TABLE IF NOT EXISTS licence_pricing_decisions (
  uid TEXT PRIMARY KEY,
  licence_uid TEXT NOT NULL REFERENCES territory_licences(uid),
  snapshot_uid TEXT NOT NULL REFERENCES country_pricing_snapshots(uid),
  currency TEXT NOT NULL,
  recommended_initial_fee_cents INTEGER CHECK (recommended_initial_fee_cents IS NULL OR typeof(recommended_initial_fee_cents) = 'integer'),
  recommended_annual_fee_cents INTEGER CHECK (recommended_annual_fee_cents IS NULL OR typeof(recommended_annual_fee_cents) = 'integer'),
  recommended_royalty_bps INTEGER CHECK (recommended_royalty_bps IS NULL OR typeof(recommended_royalty_bps) = 'integer'),
  recommended_minimum_royalty_cents INTEGER CHECK (recommended_minimum_royalty_cents IS NULL OR typeof(recommended_minimum_royalty_cents) = 'integer'),
  recommended_regulatory_surcharge_cents INTEGER CHECK (recommended_regulatory_surcharge_cents IS NULL OR typeof(recommended_regulatory_surcharge_cents) = 'integer'),
  accepted_initial_fee_cents INTEGER CHECK (accepted_initial_fee_cents IS NULL OR typeof(accepted_initial_fee_cents) = 'integer'),
  accepted_annual_fee_cents INTEGER CHECK (accepted_annual_fee_cents IS NULL OR typeof(accepted_annual_fee_cents) = 'integer'),
  accepted_royalty_bps INTEGER CHECK (accepted_royalty_bps IS NULL OR typeof(accepted_royalty_bps) = 'integer'),
  accepted_minimum_royalty_cents INTEGER CHECK (accepted_minimum_royalty_cents IS NULL OR typeof(accepted_minimum_royalty_cents) = 'integer'),
  accepted_regulatory_surcharge_cents INTEGER CHECK (accepted_regulatory_surcharge_cents IS NULL OR typeof(accepted_regulatory_surcharge_cents) = 'integer'),
  decision TEXT NOT NULL CHECK (decision IN ('accepted', 'overridden')),
  override_reason TEXT,
  effective_from TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  created_by TEXT NOT NULL,
  -- An override always says why.
  CHECK (decision = 'accepted' OR (override_reason IS NOT NULL AND length(trim(override_reason)) > 0))
);
CREATE INDEX IF NOT EXISTS idx_licence_pricing_decisions_licence ON licence_pricing_decisions (licence_uid, created_at);

CREATE TRIGGER IF NOT EXISTS trg_licence_pricing_decisions_no_update
BEFORE UPDATE ON licence_pricing_decisions
BEGIN
  SELECT RAISE(ABORT, 'licence_pricing_decisions rows are append-only');
END;

CREATE TRIGGER IF NOT EXISTS trg_licence_pricing_decisions_no_delete
BEFORE DELETE ON licence_pricing_decisions
BEGIN
  SELECT RAISE(ABORT, 'licence_pricing_decisions rows are append-only');
END;
