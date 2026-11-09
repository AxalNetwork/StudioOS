-- D5017 (#5017) — country pricing, part 4: recommendations reach a licence.
--
-- Additive only. No licence, invoice, contract or program-grant row is read or
-- written here, and every statement is re-runnable except the ALTERs, which
-- the migration runner applies once (as every ADD COLUMN in this folder).
--
-- THE PRICING BASIS. A licence over one country is priced from that country. A
-- licence over several is never averaged invisibly: HQ records a basis first —
--   primary_country  one named country of the territory prices the licence;
--   basket_weighted  every country of the territory, each with a weight in basis
--                    points, the weights totalling 10000;
--   hq_override      HQ sets the figures; the named country's recommendation is
--                    shown for reference and every apply is an override.
-- The basis is one current row per licence with a revision; its history is the
-- admin audit log.
CREATE TABLE IF NOT EXISTS licence_pricing_policies (
  licence_uid TEXT PRIMARY KEY REFERENCES territory_licences(uid),
  basis TEXT NOT NULL CHECK (basis IN ('primary_country', 'basket_weighted', 'hq_override')),
  primary_country TEXT CHECK (primary_country IS NULL OR (length(primary_country) = 2 AND primary_country GLOB '[A-Z][A-Z]')),
  -- {"FR": 6000, "BE": 4000}: basket_weighted only, totalling 10000 (checked by the route and again below).
  weights_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(weights_json)),
  reason TEXT NOT NULL CHECK (length(trim(reason)) >= 3),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (typeof(revision) = 'integer' AND revision >= 1),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_by TEXT NOT NULL,
  CHECK (basis = 'basket_weighted' OR primary_country IS NOT NULL),
  CHECK (basis <> 'basket_weighted' OR weights_json <> '{}')
);

-- What a licence's recommendation was on one day: the basis, the country
-- snapshots it was built from with their weights, and the combined figures.
-- Append-only, like the country snapshots it names, so an apply can always say
-- exactly which recommendation it accepted or overrode.
CREATE TABLE IF NOT EXISTS licence_pricing_snapshots (
  uid TEXT PRIMARY KEY,
  licence_uid TEXT NOT NULL REFERENCES territory_licences(uid),
  basis TEXT NOT NULL CHECK (basis IN ('primary_country', 'basket_weighted', 'hq_override')),
  -- 0 when the licence covers one country and no basis was recorded: the one
  -- case where the basis is implied, not chosen.
  policy_revision INTEGER NOT NULL CHECK (typeof(policy_revision) = 'integer' AND policy_revision >= 0),
  -- The territory as it stood, sorted: an apply refuses a snapshot whose territory has since changed.
  territory_json TEXT NOT NULL CHECK (json_valid(territory_json)),
  -- [{"country_code":"FR","weight_bps":6000,"snapshot_uid":"…"}, …]
  components_json TEXT NOT NULL CHECK (json_valid(components_json)),
  -- The country snapshot carrying the largest weight (the primary one for a single country): the decision's FK.
  lead_snapshot_uid TEXT NOT NULL REFERENCES country_pricing_snapshots(uid),
  pricing_model_uid TEXT NOT NULL REFERENCES pricing_models(uid),
  pricing_model_version TEXT NOT NULL,
  currency TEXT NOT NULL,
  available INTEGER NOT NULL CHECK (available IN (0, 1)),
  unavailable_reason TEXT,
  recommended_initial_fee_cents INTEGER CHECK (recommended_initial_fee_cents IS NULL OR typeof(recommended_initial_fee_cents) = 'integer'),
  recommended_annual_fee_cents INTEGER CHECK (recommended_annual_fee_cents IS NULL OR typeof(recommended_annual_fee_cents) = 'integer'),
  recommended_royalty_bps INTEGER CHECK (recommended_royalty_bps IS NULL OR typeof(recommended_royalty_bps) = 'integer'),
  recommended_minimum_royalty_cents INTEGER CHECK (recommended_minimum_royalty_cents IS NULL OR typeof(recommended_minimum_royalty_cents) = 'integer'),
  recommended_regulatory_surcharge_cents INTEGER CHECK (recommended_regulatory_surcharge_cents IS NULL OR typeof(recommended_regulatory_surcharge_cents) = 'integer'),
  trace_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(trace_json)),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  created_by TEXT NOT NULL,
  -- An unavailable recommendation carries no figure: never a zero standing in for "could not price".
  CHECK (available = 1 OR (recommended_annual_fee_cents IS NULL AND recommended_initial_fee_cents IS NULL AND recommended_royalty_bps IS NULL))
);
CREATE INDEX IF NOT EXISTS idx_licence_pricing_snapshots_licence ON licence_pricing_snapshots (licence_uid, created_at);

CREATE TRIGGER IF NOT EXISTS trg_licence_pricing_snapshots_no_update
BEFORE UPDATE ON licence_pricing_snapshots
BEGIN
  SELECT RAISE(ABORT, 'licence_pricing_snapshots rows are append-only');
END;

CREATE TRIGGER IF NOT EXISTS trg_licence_pricing_snapshots_no_delete
BEFORE DELETE ON licence_pricing_snapshots
BEGIN
  SELECT RAISE(ABORT, 'licence_pricing_snapshots rows are append-only');
END;

-- The decision row (D5014) gains what an apply needs to be reproducible and
-- reviewable: the licence snapshot, the terms revision it was made against and
-- the one it made, when pricing is next reviewed, whether a contractual term
-- changed (and so the agreement may no longer match), and how the branch push
-- ended. Older rows read NULL: "not recorded", not "no".
ALTER TABLE licence_pricing_decisions ADD COLUMN licence_snapshot_uid TEXT REFERENCES licence_pricing_snapshots(uid);
ALTER TABLE licence_pricing_decisions ADD COLUMN reason TEXT;
ALTER TABLE licence_pricing_decisions ADD COLUMN terms_revision_before INTEGER;
ALTER TABLE licence_pricing_decisions ADD COLUMN terms_revision_after INTEGER;
ALTER TABLE licence_pricing_decisions ADD COLUMN pricing_review_on TEXT;
ALTER TABLE licence_pricing_decisions ADD COLUMN contractual_change INTEGER CHECK (contractual_change IS NULL OR contractual_change IN (0, 1));
ALTER TABLE licence_pricing_decisions ADD COLUMN agreement_acknowledged INTEGER CHECK (agreement_acknowledged IS NULL OR agreement_acknowledged IN (0, 1));
ALTER TABLE licence_pricing_decisions ADD COLUMN contract_uid_at_decision TEXT;
ALTER TABLE licence_pricing_decisions ADD COLUMN review_uid TEXT;

-- The annual review. A fresh recommendation never changes a licence; it opens
-- one of these, classified against the licence's current terms, and HQ closes
-- it: keep the current terms, apply, override, or postpone (with a reason and a
-- date). At most one open review per licence.
CREATE TABLE IF NOT EXISTS licence_pricing_reviews (
  uid TEXT PRIMARY KEY,
  licence_uid TEXT NOT NULL REFERENCES territory_licences(uid),
  licence_snapshot_uid TEXT NOT NULL REFERENCES licence_pricing_snapshots(uid),
  kind TEXT NOT NULL CHECK (kind IN ('unchanged', 'increase', 'decrease', 'incomplete')),
  due_on TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'open' CHECK (state IN ('open', 'kept', 'applied', 'overridden', 'postponed')),
  current_annual_fee_cents INTEGER,
  current_royalty_bps INTEGER,
  resolution_reason TEXT,
  postponed_until TEXT,
  decision_uid TEXT REFERENCES licence_pricing_decisions(uid),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (typeof(revision) = 'integer' AND revision >= 1),
  opened_at TEXT NOT NULL DEFAULT (datetime('now')),
  opened_by TEXT NOT NULL,
  resolved_at TEXT,
  resolved_by TEXT,
  CHECK (state = 'open' OR (resolved_at IS NOT NULL AND resolved_by IS NOT NULL)),
  CHECK (state NOT IN ('kept', 'postponed') OR (resolution_reason IS NOT NULL AND length(trim(resolution_reason)) >= 3)),
  CHECK (state <> 'postponed' OR postponed_until IS NOT NULL),
  CHECK (state NOT IN ('applied', 'overridden') OR decision_uid IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_licence_pricing_reviews_one_open ON licence_pricing_reviews (licence_uid) WHERE state = 'open';
CREATE INDEX IF NOT EXISTS idx_licence_pricing_reviews_licence ON licence_pricing_reviews (licence_uid, opened_at);

-- A closed review stays closed, and nothing is deleted.
CREATE TRIGGER IF NOT EXISTS trg_licence_pricing_reviews_closed
BEFORE UPDATE ON licence_pricing_reviews
WHEN OLD.state <> 'open' OR NEW.revision <> OLD.revision + 1
  OR NEW.licence_uid IS NOT OLD.licence_uid OR NEW.licence_snapshot_uid IS NOT OLD.licence_snapshot_uid OR NEW.kind IS NOT OLD.kind
BEGIN
  SELECT RAISE(ABORT, 'licence_pricing_review_closed');
END;

CREATE TRIGGER IF NOT EXISTS trg_licence_pricing_reviews_no_delete
BEFORE DELETE ON licence_pricing_reviews
BEGIN
  SELECT RAISE(ABORT, 'licence_pricing_reviews rows are never deleted');
END;
