-- D5018 (#5018) — country pricing, part 5: program prices from the country index.
--
-- Additive only. No program grant, default term, licence or invoice row is read
-- or written here.
--
-- THE GLOBAL REFERENCE PRICE. Each grantable program may have one active
-- reference price, versioned: publishing a new one retires the previous one in
-- the same batch, and a published version's figures never change (the trigger
-- below). These are commercial defaults, separate from the operational default
-- terms in `program_grant_defaults` (D982), which stay as they are. A program
-- with no row has no base price: it reads "Not recorded", never free.
CREATE TABLE IF NOT EXISTS program_pricing_defaults (
  uid TEXT PRIMARY KEY,
  program_key TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (typeof(version) = 'integer' AND version >= 1),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'retired')),
  currency TEXT NOT NULL CHECK (length(currency) = 3 AND currency = upper(currency)),
  base_annual_fee_cents INTEGER NOT NULL CHECK (typeof(base_annual_fee_cents) = 'integer' AND base_annual_fee_cents > 0),
  base_initial_fee_cents INTEGER CHECK (base_initial_fee_cents IS NULL OR (typeof(base_initial_fee_cents) = 'integer' AND base_initial_fee_cents >= 0)),
  -- Optional bounds on the country-adjusted fee, as multipliers of the base in millionths (0.8 = 800000).
  floor_multiplier_ppm INTEGER CHECK (floor_multiplier_ppm IS NULL OR (typeof(floor_multiplier_ppm) = 'integer' AND floor_multiplier_ppm > 0)),
  ceiling_multiplier_ppm INTEGER CHECK (ceiling_multiplier_ppm IS NULL OR (typeof(ceiling_multiplier_ppm) = 'integer' AND ceiling_multiplier_ppm > 0)),
  -- The commercial increment the recommendation rounds to. NULL takes the pricing model's own (fee_rounding_cents).
  fee_rounding_cents INTEGER CHECK (fee_rounding_cents IS NULL OR (typeof(fee_rounding_cents) = 'integer' AND fee_rounding_cents > 0)),
  effective_from TEXT NOT NULL,
  reason TEXT NOT NULL CHECK (length(trim(reason)) >= 3),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  created_by TEXT NOT NULL,
  retired_at TEXT,
  UNIQUE (program_key, version),
  CHECK (floor_multiplier_ppm IS NULL OR ceiling_multiplier_ppm IS NULL OR floor_multiplier_ppm <= ceiling_multiplier_ppm)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_program_pricing_defaults_one_active ON program_pricing_defaults (program_key) WHERE status = 'active';

-- A published reference price is frozen: only active → retired moves.
CREATE TRIGGER IF NOT EXISTS trg_program_pricing_defaults_frozen
BEFORE UPDATE ON program_pricing_defaults
WHEN NEW.uid IS NOT OLD.uid OR NEW.program_key IS NOT OLD.program_key OR NEW.version IS NOT OLD.version
  OR NEW.currency IS NOT OLD.currency OR NEW.base_annual_fee_cents IS NOT OLD.base_annual_fee_cents
  OR NEW.base_initial_fee_cents IS NOT OLD.base_initial_fee_cents OR NEW.floor_multiplier_ppm IS NOT OLD.floor_multiplier_ppm
  OR NEW.ceiling_multiplier_ppm IS NOT OLD.ceiling_multiplier_ppm OR NEW.fee_rounding_cents IS NOT OLD.fee_rounding_cents OR NEW.effective_from IS NOT OLD.effective_from
  OR NEW.reason IS NOT OLD.reason OR NEW.created_by IS NOT OLD.created_by
  OR OLD.status = 'retired'
BEGIN
  SELECT RAISE(ABORT, 'program_pricing_default_immutable');
END;

CREATE TRIGGER IF NOT EXISTS trg_program_pricing_defaults_no_delete
BEFORE DELETE ON program_pricing_defaults
BEGIN
  SELECT RAISE(ABORT, 'program_pricing_default_immutable');
END;

-- What HQ accepted for one program on one licence, and from what: the base
-- price version, the licence's country recommendation (D5017's snapshot) and
-- its index, the recommendation with its unrounded trace, the accepted fee,
-- and an override's reason. Append-only. `sequence` counts this licence's
-- decisions for this program, so its history reads in order; the grant's
-- terms revision it produced ties it to the grant's own history (D4805).
CREATE TABLE IF NOT EXISTS program_pricing_decisions (
  uid TEXT PRIMARY KEY,
  licence_uid TEXT NOT NULL REFERENCES territory_licences(uid),
  program_key TEXT NOT NULL,
  grant_uid TEXT,
  sequence INTEGER NOT NULL CHECK (typeof(sequence) = 'integer' AND sequence >= 1),
  pricing_default_uid TEXT REFERENCES program_pricing_defaults(uid),
  licence_snapshot_uid TEXT REFERENCES licence_pricing_snapshots(uid),
  pricing_model_version TEXT,
  country_index_ppm INTEGER CHECK (country_index_ppm IS NULL OR typeof(country_index_ppm) = 'integer'),
  currency TEXT NOT NULL,
  base_annual_fee_cents INTEGER,
  recommended_annual_fee_cents INTEGER CHECK (recommended_annual_fee_cents IS NULL OR typeof(recommended_annual_fee_cents) = 'integer'),
  recommended_initial_fee_cents INTEGER CHECK (recommended_initial_fee_cents IS NULL OR typeof(recommended_initial_fee_cents) = 'integer'),
  accepted_annual_fee_cents INTEGER NOT NULL CHECK (typeof(accepted_annual_fee_cents) = 'integer' AND accepted_annual_fee_cents >= 0),
  accepted_initial_fee_cents INTEGER CHECK (accepted_initial_fee_cents IS NULL OR (typeof(accepted_initial_fee_cents) = 'integer' AND accepted_initial_fee_cents >= 0)),
  decision TEXT NOT NULL CHECK (decision IN ('accepted', 'overridden')),
  override_reason TEXT,
  reason TEXT NOT NULL,
  effective_from TEXT NOT NULL,
  effective_to TEXT,
  grant_terms_revision INTEGER,
  trace_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(trace_json)),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  created_by TEXT NOT NULL,
  UNIQUE (licence_uid, program_key, sequence),
  CHECK (decision = 'accepted' OR (override_reason IS NOT NULL AND length(trim(override_reason)) >= 3)),
  -- Accepting means taking a recommendation; with none, the figure is HQ's own and is an override.
  CHECK (decision = 'overridden' OR recommended_annual_fee_cents IS NOT NULL),
  CHECK (effective_to IS NULL OR effective_to > effective_from)
);
CREATE INDEX IF NOT EXISTS idx_program_pricing_decisions_licence ON program_pricing_decisions (licence_uid, program_key, sequence);

CREATE TRIGGER IF NOT EXISTS trg_program_pricing_decisions_no_update
BEFORE UPDATE ON program_pricing_decisions
BEGIN
  SELECT RAISE(ABORT, 'program_pricing_decisions rows are append-only');
END;

CREATE TRIGGER IF NOT EXISTS trg_program_pricing_decisions_no_delete
BEFORE DELETE ON program_pricing_decisions
BEGIN
  SELECT RAISE(ABORT, 'program_pricing_decisions rows are append-only');
END;
