-- D7704 (#7704): a market size is saved as one version — its inputs, its
-- figures and its history together, computed by the Worker (formula version 2).
--
-- Until now the sizing page did the arithmetic in the browser and saved the
-- result and the assumptions in two requests. This migration reverses
-- migration 247's "one row per project, no versioned table": a sizing save now
-- appends a version that holds the inputs it was computed from, so a stored
-- version recomputes to its stored figures from its own rows.
-- `project_market_assumptions` stays the drawer's current state.
--
-- `market_sizing_inputs` is an AI task key elsewhere; these names avoid it.
--
-- Money is whole USD (INTEGER), rounded once, the same currency as
-- `projects.tam/.sam/.som` and `market_figures`. `tam_override` is stored in
-- whole USD as well; the drawer types it in millions.
--
-- APPEND-ONLY, as `market_figures` is (D6011): an UPDATE trigger refuses any
-- rewrite, and only a reference may go NULL (the author, or an input's source,
-- when the row it points at is deleted). There is NO delete trigger: a
-- project's hard delete (`services/projectTrash.ts`) removes the project row
-- and relies on the cascade to remove its versions and their inputs.
--
-- No BEGIN/COMMIT: D1's HTTP API rejects transaction statements inside a
-- migration file.

CREATE TABLE IF NOT EXISTS market_sizing_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  version_number INTEGER NOT NULL CHECK (version_number >= 1),
  formula_version INTEGER NOT NULL CHECK (formula_version >= 2),
  scenario TEXT NOT NULL DEFAULT 'base',
  computed_tam INTEGER CHECK (computed_tam IS NULL OR computed_tam >= 0),
  tam_override INTEGER CHECK (tam_override IS NULL OR tam_override >= 0),
  tam_override_reason TEXT,
  tam INTEGER NOT NULL CHECK (tam >= 0),
  sam INTEGER NOT NULL CHECK (sam >= 0 AND sam <= tam),
  som INTEGER NOT NULL CHECK (som >= 0 AND som <= sam),
  som_limit TEXT NOT NULL CHECK (som_limit IN ('win_rate', 'capacity', 'both')),
  currency TEXT NOT NULL DEFAULT 'USD' CHECK (currency = 'USD'),
  reference_year INTEGER,
  horizon_months REAL NOT NULL CHECK (horizon_months >= 0),
  author_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (project_id, version_number),
  CHECK ((tam_override IS NULL) = (tam_override_reason IS NULL))
);

CREATE INDEX IF NOT EXISTS idx_market_sizing_versions_project
  ON market_sizing_versions (project_id, version_number);

-- One row per input of a version. `value` is the number the formula used,
-- `typed_text` the text as it was typed ('41,200 firms'), `unit` the unit the
-- formula reads it in. `label` says whether the founder entered it as a figure
-- or marked it an assumption, with a note. The source columns stay empty
-- until per-input sources land (#7725).
CREATE TABLE IF NOT EXISTS market_sizing_version_inputs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  version_id INTEGER NOT NULL REFERENCES market_sizing_versions(id) ON DELETE CASCADE,
  input_key TEXT NOT NULL,
  value REAL NOT NULL CHECK (value >= 0),
  typed_text TEXT,
  unit TEXT NOT NULL,
  label TEXT NOT NULL DEFAULT 'entered' CHECK (label IN ('entered', 'assumption')),
  note TEXT,
  source_title TEXT,
  source_url TEXT,
  market_source_id INTEGER REFERENCES market_sources(id) ON DELETE SET NULL,
  UNIQUE (version_id, input_key)
);

CREATE TRIGGER IF NOT EXISTS market_sizing_versions_append_only
BEFORE UPDATE ON market_sizing_versions
WHEN NEW.uid IS NOT OLD.uid OR NEW.project_id IS NOT OLD.project_id
  OR NEW.version_number IS NOT OLD.version_number OR NEW.formula_version IS NOT OLD.formula_version
  OR NEW.scenario IS NOT OLD.scenario OR NEW.computed_tam IS NOT OLD.computed_tam
  OR NEW.tam_override IS NOT OLD.tam_override OR NEW.tam_override_reason IS NOT OLD.tam_override_reason
  OR NEW.tam IS NOT OLD.tam OR NEW.sam IS NOT OLD.sam OR NEW.som IS NOT OLD.som
  OR NEW.som_limit IS NOT OLD.som_limit OR NEW.currency IS NOT OLD.currency
  OR NEW.reference_year IS NOT OLD.reference_year OR NEW.horizon_months IS NOT OLD.horizon_months
  OR NEW.created_at IS NOT OLD.created_at
  OR (NEW.author_id IS NOT NULL AND NEW.author_id IS NOT OLD.author_id)
BEGIN
  SELECT RAISE(ABORT, 'market_sizing_versions is append-only (D7704).');
END;

CREATE TRIGGER IF NOT EXISTS market_sizing_version_inputs_append_only
BEFORE UPDATE ON market_sizing_version_inputs
WHEN NEW.version_id IS NOT OLD.version_id OR NEW.input_key IS NOT OLD.input_key
  OR NEW.value IS NOT OLD.value OR NEW.typed_text IS NOT OLD.typed_text
  OR NEW.unit IS NOT OLD.unit OR NEW.label IS NOT OLD.label OR NEW.note IS NOT OLD.note
  OR NEW.source_title IS NOT OLD.source_title OR NEW.source_url IS NOT OLD.source_url
  OR (NEW.market_source_id IS NOT NULL AND NEW.market_source_id IS NOT OLD.market_source_id)
BEGIN
  SELECT RAISE(ABORT, 'market_sizing_version_inputs is append-only (D7704).');
END;

-- The version a `market_figures` row was saved by. NULL for a figure typed
-- anywhere else (`PUT /api/projects/:id`) and for every row saved before
-- formula version 2. D6011's trigger names its columns and does not cover
-- this one, so its own trigger lets it only go NULL.
ALTER TABLE market_figures ADD COLUMN sizing_version_id INTEGER REFERENCES market_sizing_versions(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_market_figures_sizing_version
  ON market_figures (sizing_version_id);

CREATE TRIGGER IF NOT EXISTS market_figures_sizing_version_only_clears
BEFORE UPDATE OF sizing_version_id ON market_figures
WHEN NEW.sizing_version_id IS NOT NULL AND NEW.sizing_version_id IS NOT OLD.sizing_version_id
BEGIN
  SELECT RAISE(ABORT, 'market_figures.sizing_version_id: a row''s version is never rewritten (D7704).');
END;

-- The drawer's four new inputs, as typed text like the rest of the row (247).
ALTER TABLE project_market_assumptions ADD COLUMN horizon_months TEXT;
ALTER TABLE project_market_assumptions ADD COLUMN sales_cycle_months TEXT;
ALTER TABLE project_market_assumptions ADD COLUMN retention_pct TEXT;
ALTER TABLE project_market_assumptions ADD COLUMN tam_override_reason TEXT;
