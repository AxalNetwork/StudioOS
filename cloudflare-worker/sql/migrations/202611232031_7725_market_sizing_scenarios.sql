-- D7725 (#7725): where each sizing input came from, low and high scenarios
-- beside base, and a top-down check. Adds tables and nullable columns only;
-- nothing D7704 wrote is changed, so a version saved before this migration
-- reads and recomputes as it did.
--
-- The base scenario stays the `market_sizing_versions` row and its
-- `market_sizing_version_inputs` rows (D7704). Low and high, when a save holds
-- them, are one row each in `market_sizing_scenarios`. Every estimate of every
-- input of a labelled save (base included) is one row in
-- `market_sizing_input_estimates`, with its source copied at save time.
--
-- APPEND-ONLY, as D7704's tables are: UPDATE triggers refuse any rewrite, and
-- only a reference may go NULL (an estimate's `market_source_id` when the
-- source is deleted). No delete trigger: a project's hard delete relies on the
-- cascade from `market_sizing_versions`.
--
-- No BEGIN/COMMIT: D1's HTTP API rejects transaction statements inside a
-- migration file.

-- Whether revenue per account is per year or the total over the time horizon;
-- NULL on every version saved before D7725 (read per year, as formula version
-- 2 always did). The top-down TAM and its gap to the bottom-up TAM, whole USD;
-- never written to the project.
ALTER TABLE market_sizing_versions ADD COLUMN revenue_basis TEXT CHECK (revenue_basis IS NULL OR revenue_basis IN ('annual', 'cumulative'));
ALTER TABLE market_sizing_versions ADD COLUMN top_down_tam INTEGER CHECK (top_down_tam IS NULL OR top_down_tam >= 0);
ALTER TABLE market_sizing_versions ADD COLUMN top_down_gap INTEGER;

-- D7704's trigger names its columns and does not cover these three.
CREATE TRIGGER IF NOT EXISTS market_sizing_versions_7725_append_only
BEFORE UPDATE ON market_sizing_versions
WHEN NEW.revenue_basis IS NOT OLD.revenue_basis OR NEW.top_down_tam IS NOT OLD.top_down_tam
  OR NEW.top_down_gap IS NOT OLD.top_down_gap
BEGIN
  SELECT RAISE(ABORT, 'market_sizing_versions is append-only (D7725).');
END;

-- Low and high: the figures each scenario's own inputs give, as a version row holds base's.
CREATE TABLE IF NOT EXISTS market_sizing_scenarios (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  version_id INTEGER NOT NULL REFERENCES market_sizing_versions(id) ON DELETE CASCADE,
  scenario TEXT NOT NULL CHECK (scenario IN ('low', 'high')),
  computed_tam INTEGER CHECK (computed_tam IS NULL OR computed_tam >= 0),
  tam_override INTEGER CHECK (tam_override IS NULL OR tam_override >= 0),
  tam_override_reason TEXT,
  tam INTEGER NOT NULL CHECK (tam >= 0),
  sam INTEGER NOT NULL CHECK (sam >= 0 AND sam <= tam),
  som INTEGER NOT NULL CHECK (som >= 0 AND som <= sam),
  som_limit TEXT NOT NULL CHECK (som_limit IN ('win_rate', 'capacity', 'both')),
  horizon_months REAL NOT NULL CHECK (horizon_months >= 0),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (version_id, scenario),
  CHECK ((tam_override IS NULL) = (tam_override_reason IS NULL))
);

CREATE TRIGGER IF NOT EXISTS market_sizing_scenarios_append_only
BEFORE UPDATE ON market_sizing_scenarios
WHEN NEW.version_id IS NOT OLD.version_id OR NEW.scenario IS NOT OLD.scenario
  OR NEW.computed_tam IS NOT OLD.computed_tam OR NEW.tam_override IS NOT OLD.tam_override
  OR NEW.tam_override_reason IS NOT OLD.tam_override_reason OR NEW.tam IS NOT OLD.tam
  OR NEW.sam IS NOT OLD.sam OR NEW.som IS NOT OLD.som OR NEW.som_limit IS NOT OLD.som_limit
  OR NEW.horizon_months IS NOT OLD.horizon_months OR NEW.created_at IS NOT OLD.created_at
BEGIN
  SELECT RAISE(ABORT, 'market_sizing_scenarios is append-only (D7725).');
END;

-- One row per estimate of one input in one scenario. `value` is the number the
-- formula reads (USD, the version's reference year); `original_value` is the
-- number as its source gave it, before a conversion or adjustment. Exactly one
-- estimate per input and scenario is `used`. `source_kind` is one of the four
-- kinds; the source columns and `evidence_json` are copied from the stored row
-- at save time, so a newer vintage never changes what the version reads.
-- `observation_id` is indexed for the superseded-evidence read (#7726).
CREATE TABLE IF NOT EXISTS market_sizing_input_estimates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  version_id INTEGER NOT NULL REFERENCES market_sizing_versions(id) ON DELETE CASCADE,
  scenario TEXT NOT NULL CHECK (scenario IN ('low', 'base', 'high')),
  input_key TEXT NOT NULL,
  estimate_no INTEGER NOT NULL CHECK (estimate_no >= 1),
  used INTEGER NOT NULL CHECK (used IN (0, 1)),
  used_reason TEXT,
  value REAL NOT NULL CHECK (value >= 0),
  original_value REAL NOT NULL CHECK (original_value >= 0),
  typed_text TEXT,
  unit TEXT NOT NULL,
  currency TEXT,
  reference_year INTEGER,
  source_kind TEXT NOT NULL CHECK (source_kind IN ('observation', 'market_source', 'eadwyn_fill', 'assumption')),
  note TEXT,
  observation_id INTEGER,
  market_source_id INTEGER REFERENCES market_sources(id) ON DELETE SET NULL,
  fill_provenance_id INTEGER,
  source_title TEXT,
  source_url TEXT,
  source_name TEXT,
  evidence_json TEXT,
  conversion_json TEXT,
  adjustment_json TEXT,
  UNIQUE (version_id, scenario, input_key, estimate_no),
  CHECK (source_kind <> 'assumption' OR note IS NOT NULL),
  CHECK (source_kind <> 'observation' OR observation_id IS NOT NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_market_sizing_estimates_one_used
  ON market_sizing_input_estimates (version_id, scenario, input_key) WHERE used = 1;

CREATE INDEX IF NOT EXISTS idx_market_sizing_estimates_observation
  ON market_sizing_input_estimates (observation_id);

CREATE TRIGGER IF NOT EXISTS market_sizing_input_estimates_append_only
BEFORE UPDATE ON market_sizing_input_estimates
WHEN NEW.version_id IS NOT OLD.version_id OR NEW.scenario IS NOT OLD.scenario
  OR NEW.input_key IS NOT OLD.input_key OR NEW.estimate_no IS NOT OLD.estimate_no
  OR NEW.used IS NOT OLD.used OR NEW.used_reason IS NOT OLD.used_reason
  OR NEW.value IS NOT OLD.value OR NEW.original_value IS NOT OLD.original_value
  OR NEW.typed_text IS NOT OLD.typed_text OR NEW.unit IS NOT OLD.unit
  OR NEW.currency IS NOT OLD.currency OR NEW.reference_year IS NOT OLD.reference_year
  OR NEW.source_kind IS NOT OLD.source_kind OR NEW.note IS NOT OLD.note
  OR NEW.observation_id IS NOT OLD.observation_id
  OR (NEW.market_source_id IS NOT NULL AND NEW.market_source_id IS NOT OLD.market_source_id)
  OR NEW.fill_provenance_id IS NOT OLD.fill_provenance_id
  OR NEW.source_title IS NOT OLD.source_title OR NEW.source_url IS NOT OLD.source_url
  OR NEW.source_name IS NOT OLD.source_name OR NEW.evidence_json IS NOT OLD.evidence_json
  OR NEW.conversion_json IS NOT OLD.conversion_json OR NEW.adjustment_json IS NOT OLD.adjustment_json
BEGIN
  SELECT RAISE(ABORT, 'market_sizing_input_estimates is append-only (D7725).');
END;
