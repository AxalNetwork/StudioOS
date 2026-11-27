-- D5019 (#5019) — country pricing, part 6: exclusivity, development commitments
-- and regional / master-franchise territories.
--
-- Additive only. No licence, territory, term, invoice or contract row is read or
-- written here; `licence_territories` and its one-holder-per-country index (the
-- operating-licence overlap rule, migration 187) stay exactly as they are.
--
-- THE OPERATING FEE AND EXCLUSIVITY ARE INDEPENDENT. Paying the licence fee buys
-- the operating licence; territorial exclusivity is its own versioned term, with
-- its own development commitments, and carries no fee column.

-- Named sub-territories: a subnational region or a metro inside one country, or
-- a multi-country region. A region may sit inside a parent region. Ids are HQ's
-- stable identifiers, e.g. `US-CA`, `US-NYC-METRO`, `NORDICS`.
CREATE TABLE IF NOT EXISTS territory_regions (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 2 AND 40 AND id = upper(id) AND id NOT GLOB '*[^A-Z0-9-]*'),
  kind TEXT NOT NULL CHECK (kind IN ('subnational', 'metro', 'multi_country')),
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 120),
  -- The countries the region lies in: one for a subnational region or metro, several for a multi-country region.
  countries_json TEXT NOT NULL CHECK (json_valid(countries_json) AND json_type(countries_json) = 'array' AND json_array_length(countries_json) >= 1),
  parent_region_id TEXT REFERENCES territory_regions(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  created_by TEXT NOT NULL,
  CHECK (kind = 'multi_country' OR json_array_length(countries_json) = 1),
  CHECK (parent_region_id IS NULL OR parent_region_id <> id)
);

-- One licence's exclusivity, versioned. Each change writes a new row with the
-- next revision and marks the previous one superseded in the same batch; one
-- current row per licence. A superseded row never changes again.
CREATE TABLE IF NOT EXISTS licence_exclusivity_terms (
  uid TEXT PRIMARY KEY,
  licence_uid TEXT NOT NULL REFERENCES territory_licences(uid),
  revision INTEGER NOT NULL CHECK (typeof(revision) = 'integer' AND revision >= 1),
  scope_type TEXT NOT NULL CHECK (scope_type IN ('non_exclusive', 'country_exclusive', 'regional_exclusive', 'master_franchise')),
  -- {"countries": ["US"], "regions": ["US-CA"]}: ISO2 codes and/or territory_regions ids.
  territory_json TEXT NOT NULL DEFAULT '{"countries":[],"regions":[]}' CHECK (json_valid(territory_json)),
  -- An operating licence modelled inside a master franchise names it here.
  parent_licence_uid TEXT REFERENCES territory_licences(uid),
  -- A master franchise lists the operating licences it contains: the one way a master may cover a country another
  -- licence operates in. A child's parent_licence_uid must be a master that lists it.
  child_licences_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(child_licences_json) AND json_type(child_licences_json) = 'array'),
  starts_on TEXT,
  ends_on TEXT,
  review_on TEXT,
  cure_period_days INTEGER CHECK (cure_period_days IS NULL OR (typeof(cure_period_days) = 'integer' AND cure_period_days BETWEEN 0 AND 3650)),
  -- Set by a "cure period" review decision: the date the licensee has to catch up by.
  cure_until TEXT,
  -- The development commitments, one entry per year: [{"year":1,"period_start":"…","period_end":"…",
  -- "min_revenue_cents":…,"min_cohorts":…,"min_active_members":…,"min_network":…}]. A target left out is null:
  -- no commitment, never 0.
  targets_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(targets_json) AND json_type(targets_json) = 'array'),
  state TEXT NOT NULL CHECK (state IN ('draft', 'in_force', 'at_risk', 'released', 'ended')),
  -- Whether the agreement states this exclusivity. A change to a contractual one marks the agreement as not matching.
  contractual INTEGER NOT NULL DEFAULT 1 CHECK (contractual IN (0, 1)),
  reason TEXT NOT NULL CHECK (length(trim(reason)) >= 3),
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  created_by TEXT NOT NULL,
  superseded_at TEXT,
  UNIQUE (licence_uid, revision),
  CHECK (parent_licence_uid IS NULL OR parent_licence_uid <> licence_uid),
  CHECK (scope_type = 'master_franchise' OR child_licences_json = '[]'),
  CHECK (ends_on IS NULL OR starts_on IS NULL OR ends_on >= starts_on)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_licence_exclusivity_one_current ON licence_exclusivity_terms (licence_uid) WHERE superseded_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_licence_exclusivity_parent ON licence_exclusivity_terms (parent_licence_uid) WHERE superseded_at IS NULL;

-- A version is frozen once written: the only update is marking it superseded, once.
CREATE TRIGGER IF NOT EXISTS trg_licence_exclusivity_terms_frozen
BEFORE UPDATE ON licence_exclusivity_terms
WHEN OLD.superseded_at IS NOT NULL OR NEW.superseded_at IS NULL
  OR NEW.uid IS NOT OLD.uid OR NEW.licence_uid IS NOT OLD.licence_uid OR NEW.revision IS NOT OLD.revision
  OR NEW.scope_type IS NOT OLD.scope_type OR NEW.territory_json IS NOT OLD.territory_json OR NEW.parent_licence_uid IS NOT OLD.parent_licence_uid
  OR NEW.child_licences_json IS NOT OLD.child_licences_json
  OR NEW.starts_on IS NOT OLD.starts_on OR NEW.ends_on IS NOT OLD.ends_on OR NEW.review_on IS NOT OLD.review_on
  OR NEW.cure_period_days IS NOT OLD.cure_period_days OR NEW.cure_until IS NOT OLD.cure_until OR NEW.targets_json IS NOT OLD.targets_json
  OR NEW.state IS NOT OLD.state OR NEW.contractual IS NOT OLD.contractual OR NEW.reason IS NOT OLD.reason
  OR NEW.created_at IS NOT OLD.created_at OR NEW.created_by IS NOT OLD.created_by
BEGIN
  SELECT RAISE(ABORT, 'licence_exclusivity_terms_frozen');
END;

CREATE TRIGGER IF NOT EXISTS trg_licence_exclusivity_terms_no_delete
BEFORE DELETE ON licence_exclusivity_terms
BEGIN
  SELECT RAISE(ABORT, 'licence_exclusivity_terms_frozen');
END;

-- What the licensee actually did, kept apart from the targets so a measurement
-- never overwrites a commitment. Append-only; a correction is a new row.
CREATE TABLE IF NOT EXISTS licence_performance_observations (
  uid TEXT PRIMARY KEY,
  licence_uid TEXT NOT NULL REFERENCES territory_licences(uid),
  metric TEXT NOT NULL CHECK (metric IN ('qualifying_revenue_cents', 'cohorts', 'active_members', 'network')),
  period_start TEXT NOT NULL,
  period_end TEXT NOT NULL,
  value INTEGER NOT NULL CHECK (typeof(value) = 'integer' AND value >= 0),
  source TEXT NOT NULL CHECK (length(trim(source)) >= 2),
  note TEXT,
  -- A later observation for the same metric and period replaces an earlier one in the reading, never in the store.
  supersedes_uid TEXT REFERENCES licence_performance_observations(uid),
  recorded_at TEXT NOT NULL DEFAULT (datetime('now')),
  recorded_by TEXT NOT NULL,
  CHECK (period_end >= period_start)
);
CREATE INDEX IF NOT EXISTS idx_licence_performance_observations_licence ON licence_performance_observations (licence_uid, metric, period_start);

CREATE TRIGGER IF NOT EXISTS trg_licence_performance_observations_no_update
BEFORE UPDATE ON licence_performance_observations
BEGIN
  SELECT RAISE(ABORT, 'licence_performance_observations rows are append-only');
END;

CREATE TRIGGER IF NOT EXISTS trg_licence_performance_observations_no_delete
BEFORE DELETE ON licence_performance_observations
BEGIN
  SELECT RAISE(ABORT, 'licence_performance_observations rows are append-only');
END;

-- An HQ review of a licence's exclusivity. A missed target opens one; nothing
-- revokes exclusivity by itself. HQ closes it with one action — continue, cure
-- period, reduce territory, convert to non-exclusive, end exclusivity — after a
-- consequence preview and with a reason; the action writes the next terms
-- version. One open review per licence.
CREATE TABLE IF NOT EXISTS licence_exclusivity_reviews (
  uid TEXT PRIMARY KEY,
  licence_uid TEXT NOT NULL REFERENCES territory_licences(uid),
  terms_uid TEXT NOT NULL REFERENCES licence_exclusivity_terms(uid),
  trigger TEXT NOT NULL CHECK (trigger IN ('target_missed', 'review_date', 'hq')),
  trigger_detail_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(trigger_detail_json)),
  state TEXT NOT NULL DEFAULT 'open' CHECK (state IN ('open', 'resolved')),
  action TEXT CHECK (action IS NULL OR action IN ('continue', 'cure_period', 'reduce_territory', 'convert_non_exclusive', 'end_exclusivity')),
  resolution_reason TEXT,
  consequence TEXT,
  resulting_terms_uid TEXT REFERENCES licence_exclusivity_terms(uid),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (typeof(revision) = 'integer' AND revision >= 1),
  opened_at TEXT NOT NULL DEFAULT (datetime('now')),
  opened_by TEXT NOT NULL,
  resolved_at TEXT,
  resolved_by TEXT,
  CHECK (state = 'open' OR (action IS NOT NULL AND resolution_reason IS NOT NULL AND length(trim(resolution_reason)) >= 3
    AND consequence IS NOT NULL AND resolved_at IS NOT NULL AND resolved_by IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_licence_exclusivity_reviews_one_open ON licence_exclusivity_reviews (licence_uid) WHERE state = 'open';

CREATE TRIGGER IF NOT EXISTS trg_licence_exclusivity_reviews_closed
BEFORE UPDATE ON licence_exclusivity_reviews
WHEN OLD.state <> 'open' OR NEW.revision <> OLD.revision + 1 OR NEW.licence_uid IS NOT OLD.licence_uid OR NEW.terms_uid IS NOT OLD.terms_uid
BEGIN
  SELECT RAISE(ABORT, 'licence_exclusivity_review_closed');
END;

CREATE TRIGGER IF NOT EXISTS trg_licence_exclusivity_reviews_no_delete
BEFORE DELETE ON licence_exclusivity_reviews
BEGIN
  SELECT RAISE(ABORT, 'licence_exclusivity_reviews rows are never deleted');
END;
