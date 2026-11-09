-- D5023 (#5023, part 2 of #5021) — a package's country-adjusted price for one licence, frozen.
--
-- One row is one recommendation: a package VERSION (D5022's frozen `program_packages` row) priced from one
-- licence's country recommendation (D5017's `licence_pricing_snapshots` row, which names its own frozen
-- country snapshots, basis and basket weights) under that snapshot's pricing model. It records everything it
-- came from and everything it says: the base and recommended fee, the guidance range, each included
-- program's standalone price (with the reference-price version it used), the bundle saving or the
-- `bundle_value_warning`, the warnings, and the rounding trace.
--
-- APPEND-ONLY. A country-data update, a new program reference price or a new package version makes the NEXT
-- recommendation different; it never touches this one. `inputs_key` is a digest of every input (package
-- version, licence snapshot, and each program reference-price version used), and is unique: the same inputs
-- always give the same row back instead of a second one.
--
-- NOT A PRICE ON THE LICENCE. Nothing here is accepted by or invoiced to a licence; #5024 is where a licence
-- accepts a package version and its price.
CREATE TABLE IF NOT EXISTS package_pricing_recommendations (
  uid TEXT PRIMARY KEY,
  licence_uid TEXT NOT NULL REFERENCES territory_licences(uid),
  package_uid TEXT NOT NULL REFERENCES program_packages(uid),
  package_key TEXT NOT NULL,
  package_version INTEGER NOT NULL CHECK (typeof(package_version) = 'integer' AND package_version >= 1),
  licence_snapshot_uid TEXT NOT NULL REFERENCES licence_pricing_snapshots(uid),
  -- 1 when the snapshot was the licence's latest when this was made; 0 when HQ chose an older one, with a reason.
  snapshot_is_latest INTEGER NOT NULL CHECK (snapshot_is_latest IN (0, 1)),
  snapshot_reason TEXT,
  pricing_model_version TEXT NOT NULL,
  country_index_ppm INTEGER NOT NULL CHECK (typeof(country_index_ppm) = 'integer' AND country_index_ppm > 0),
  currency TEXT NOT NULL,
  base_annual_fee_cents INTEGER NOT NULL CHECK (typeof(base_annual_fee_cents) = 'integer' AND base_annual_fee_cents > 0),
  recommended_annual_fee_cents INTEGER NOT NULL CHECK (typeof(recommended_annual_fee_cents) = 'integer' AND recommended_annual_fee_cents >= 0),
  guidance_min_cents INTEGER CHECK (guidance_min_cents IS NULL OR typeof(guidance_min_cents) = 'integer'),
  guidance_max_cents INTEGER CHECK (guidance_max_cents IS NULL OR typeof(guidance_max_cents) = 'integer'),
  -- NULL when any included program has no standalone price: never a sum of the programs that happen to have one.
  standalone_sum_cents INTEGER CHECK (standalone_sum_cents IS NULL OR typeof(standalone_sum_cents) = 'integer'),
  bundle_saving_cents INTEGER CHECK (bundle_saving_cents IS NULL OR (typeof(bundle_saving_cents) = 'integer' AND bundle_saving_cents >= 0)),
  bundle_discount_bps INTEGER CHECK (bundle_discount_bps IS NULL OR (typeof(bundle_discount_bps) = 'integer' AND bundle_discount_bps BETWEEN 0 AND 10000)),
  bundle_value_warning INTEGER NOT NULL DEFAULT 0 CHECK (bundle_value_warning IN (0, 1)),
  inputs_key TEXT NOT NULL UNIQUE,
  programs_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(programs_json)),
  warnings_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(warnings_json)),
  trace_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(trace_json)),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  created_by TEXT NOT NULL,
  CHECK (snapshot_is_latest = 1 OR (snapshot_reason IS NOT NULL AND length(trim(snapshot_reason)) >= 3)),
  -- A saving is shown only with a standalone sum to save against, and never alongside the warning.
  CHECK (bundle_saving_cents IS NULL OR (standalone_sum_cents IS NOT NULL AND bundle_value_warning = 0)),
  CHECK (bundle_value_warning = 0 OR standalone_sum_cents IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_package_pricing_recommendations_licence
  ON package_pricing_recommendations (licence_uid, package_key, created_at);

CREATE TRIGGER IF NOT EXISTS trg_package_pricing_recommendations_no_update
BEFORE UPDATE ON package_pricing_recommendations
BEGIN
  SELECT RAISE(ABORT, 'package_pricing_recommendations rows are append-only');
END;

CREATE TRIGGER IF NOT EXISTS trg_package_pricing_recommendations_no_delete
BEFORE DELETE ON package_pricing_recommendations
BEGIN
  SELECT RAISE(ABORT, 'package_pricing_recommendations rows are append-only');
END;
