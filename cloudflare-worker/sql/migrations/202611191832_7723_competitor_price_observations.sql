-- D7723 (#7723): a competitor's price, stored on stated terms with its capture
-- date and its source, kept through a rerun of the analysis, with its history.
--
-- Before this a price was a text hint found by pattern on a fetched page
-- (`extractPricingHints`, services/webFetch.ts), pooled across a candidate's
-- pages in `competitor_candidates.details_json`. A rerun could drop the
-- candidate and deleting the analysis cascaded. This table is the record a
-- person confirms: one row per observation, APPEND-ONLY.
--
-- WHAT A ROW HOLDS. The competitor's name and domain are COPIED as text, with
-- the directory company uid when `competitorDirectoryLink` finds exactly one.
-- `analysis_id` and `candidate_id` are plain values with NO foreign key, so a
-- rerun that drops the candidate, or deleting the analysis, leaves the row and
-- its competitor's name. `hint_text` is the hint verbatim when the row was
-- confirmed from one; a hint itself is never a row.
--
-- THE AMOUNT IS TEXT, NEVER A FLOAT: a usage price can be below one minor unit
-- (0.0004 per call), and the row keeps the figure exactly as the source states
-- it. '0' is a stated free price. NULL is allowed only for a quote with no
-- public figure, or once the row is withdrawn. Every vocabulary is a closed
-- set, checked here and in services/competitorPrices.ts.
--
-- HISTORY. A later capture is a new row. A correction is a new row naming the
-- row it replaces (`corrects_uid`, at most one correction per row); the
-- replaced row leaves "current" and stays readable.
--
-- WITHDRAWAL is the one change the trigger allows: withdrawn_at, _by and
-- _reason are set once, and the same UPDATE clears `amount` and `source_url`.
--
-- WHAT DELETES DO.
--   - A venture's hard delete removes that venture's rows (the cascade on
--     project_id), as market_figures does: the prices were the venture's.
--   - An account deletion (a manual erasure: DELETE FROM users) sets
--     entered_by and withdrawn_by to NULL and leaves the rows. A venture's row
--     is still read within the venture. An unattached row is read only by its
--     author, so once its author is gone nobody reads it.
--   - A deleted interview sets interview_id to NULL; the row stays.
-- So there is no delete trigger, and no route deletes a row.
--
-- A row holds no person's name, contact detail or quoted speech: an interview
-- is linked by id only.
--
-- No BEGIN/COMMIT: D1's HTTP API rejects transaction statements inside a
-- migration file.
CREATE TABLE IF NOT EXISTS competitor_price_observations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE DEFAULT (lower(hex(randomblob(16)))),
  competitor_name TEXT NOT NULL CHECK (length(trim(competitor_name)) > 0),
  competitor_domain TEXT,
  competitor_key TEXT NOT NULL,
  directory_uid TEXT,
  analysis_id TEXT,
  candidate_id TEXT,
  project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
  product TEXT NOT NULL CHECK (length(trim(product)) > 0),
  plan TEXT NOT NULL CHECK (length(trim(plan)) > 0),
  hint_text TEXT,
  charge_type TEXT NOT NULL CHECK (charge_type IN ('subscription', 'usage', 'implementation_fee', 'quote')),
  amount TEXT CHECK (amount IS NULL OR (length(amount) <= 32 AND amount GLOB '[0-9]*'
    AND amount NOT GLOB '*[^0-9.]*' AND amount NOT GLOB '*.*.*' AND amount NOT GLOB '*.')),
  currency TEXT NOT NULL CHECK (length(currency) = 3 AND currency GLOB '[A-Z][A-Z][A-Z]'),
  pricing_unit TEXT NOT NULL CHECK (pricing_unit IN ('per_seat', 'per_account', 'per_use', 'flat')),
  unit_quantity TEXT CHECK (unit_quantity IS NULL OR (length(unit_quantity) <= 32 AND unit_quantity GLOB '[0-9]*'
    AND unit_quantity NOT GLOB '*[^0-9.]*' AND unit_quantity NOT GLOB '*.*.*' AND unit_quantity NOT GLOB '*.')),
  unit_label TEXT,
  billing_period TEXT NOT NULL CHECK (billing_period IN ('monthly', 'quarterly', 'annual', 'one_time', 'per_use', 'not_stated')),
  contract_term TEXT NOT NULL CHECK (contract_term IN ('no_commitment', 'monthly', 'annual', 'multi_year', 'not_stated')),
  region TEXT NOT NULL CHECK (region IN ('global', 'north_america', 'latin_america', 'europe', 'united_kingdom', 'middle_east_africa', 'asia_pacific')),
  captured_on TEXT NOT NULL CHECK (captured_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  source_kind TEXT NOT NULL CHECK (source_kind IN ('official_page', 'filing', 'permitted_quotation', 'interview')),
  source_url TEXT CHECK (source_url IS NULL OR source_url LIKE 'https://%' OR source_url LIKE 'http://%'),
  interview_id INTEGER REFERENCES discovery_interviews(id) ON DELETE SET NULL,
  source_use_confirmed INTEGER NOT NULL CHECK (source_use_confirmed = 1),
  source_share_confirmed INTEGER NOT NULL DEFAULT 0 CHECK (source_share_confirmed IN (0, 1)),
  entered_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  entered_at TEXT NOT NULL DEFAULT (datetime('now')),
  corrects_uid TEXT,
  withdrawn_at TEXT,
  withdrawn_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  withdrawn_reason TEXT,
  CHECK (amount IS NOT NULL OR charge_type = 'quote' OR withdrawn_at IS NOT NULL),
  CHECK ((charge_type = 'usage' AND unit_quantity IS NOT NULL AND unit_label IS NOT NULL)
    OR (charge_type <> 'usage' AND unit_quantity IS NULL AND unit_label IS NULL)),
  CHECK (billing_period <> 'not_stated' OR charge_type = 'quote'),
  CHECK (source_url IS NOT NULL OR withdrawn_at IS NOT NULL OR source_kind NOT IN ('official_page', 'filing')),
  CHECK (source_kind <> 'interview' OR project_id IS NOT NULL),
  CHECK (source_kind <> 'permitted_quotation' OR source_share_confirmed = 1),
  CHECK ((withdrawn_at IS NULL) = (withdrawn_reason IS NULL))
);

CREATE INDEX IF NOT EXISTS idx_competitor_price_obs_project
  ON competitor_price_observations (project_id, competitor_key, id);

CREATE INDEX IF NOT EXISTS idx_competitor_price_obs_author
  ON competitor_price_observations (entered_by, competitor_key, id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_competitor_price_obs_corrects
  ON competitor_price_observations (corrects_uid) WHERE corrects_uid IS NOT NULL;

-- A row is never rewritten. The references may go NULL when the user or the
-- interview they point at is deleted. The one other change is a withdrawal:
-- withdrawn_at, _by and _reason set once, from nothing, in the same UPDATE
-- that clears amount and source_url. A venture's hard delete still removes its
-- rows (the cascade above), so there is no delete trigger.
CREATE TRIGGER IF NOT EXISTS competitor_price_observations_append_only
BEFORE UPDATE ON competitor_price_observations
WHEN NEW.id IS NOT OLD.id OR NEW.uid IS NOT OLD.uid
  OR NEW.competitor_name IS NOT OLD.competitor_name OR NEW.competitor_domain IS NOT OLD.competitor_domain
  OR NEW.competitor_key IS NOT OLD.competitor_key OR NEW.directory_uid IS NOT OLD.directory_uid
  OR NEW.analysis_id IS NOT OLD.analysis_id OR NEW.candidate_id IS NOT OLD.candidate_id
  OR NEW.project_id IS NOT OLD.project_id OR NEW.product IS NOT OLD.product OR NEW.plan IS NOT OLD.plan
  OR NEW.hint_text IS NOT OLD.hint_text OR NEW.charge_type IS NOT OLD.charge_type
  OR NEW.currency IS NOT OLD.currency OR NEW.pricing_unit IS NOT OLD.pricing_unit
  OR NEW.unit_quantity IS NOT OLD.unit_quantity OR NEW.unit_label IS NOT OLD.unit_label
  OR NEW.billing_period IS NOT OLD.billing_period OR NEW.contract_term IS NOT OLD.contract_term
  OR NEW.region IS NOT OLD.region OR NEW.captured_on IS NOT OLD.captured_on
  OR NEW.source_kind IS NOT OLD.source_kind OR NEW.source_use_confirmed IS NOT OLD.source_use_confirmed
  OR NEW.source_share_confirmed IS NOT OLD.source_share_confirmed
  OR NEW.entered_at IS NOT OLD.entered_at OR NEW.corrects_uid IS NOT OLD.corrects_uid
  OR (NEW.entered_by IS NOT NULL AND NEW.entered_by IS NOT OLD.entered_by)
  OR (NEW.interview_id IS NOT NULL AND NEW.interview_id IS NOT OLD.interview_id)
  OR (NEW.withdrawn_by IS NOT NULL AND NEW.withdrawn_by IS NOT OLD.withdrawn_by
      AND NOT (OLD.withdrawn_at IS NULL AND NEW.withdrawn_at IS NOT NULL))
  OR ((NEW.amount IS NOT OLD.amount OR NEW.source_url IS NOT OLD.source_url
       OR NEW.withdrawn_at IS NOT OLD.withdrawn_at OR NEW.withdrawn_reason IS NOT OLD.withdrawn_reason)
      AND NOT (OLD.withdrawn_at IS NULL AND NEW.withdrawn_at IS NOT NULL AND NEW.withdrawn_reason IS NOT NULL
               AND NEW.amount IS NULL AND NEW.source_url IS NULL))
BEGIN
  SELECT RAISE(ABORT, 'competitor_price_observations is append-only (D7723).');
END;
