-- D7167 (#7167): Research › Funds profile — the proposed vehicle fields, each
-- with its own source and dates, and the vehicle a report row observes.
--
-- research_fund_vehicle_facts holds four fields no fund list carried as a
-- column: the manager's name, the investment stage, the investment geography
-- (where the vehicle invests, not where the manager is based) and the initial
-- cheque range. One row per vehicle and field, and every row names the list
-- it was read from, the date the list reported it and the date it was
-- imported, so the profile and the comparison can cite it like any other
-- figure. A field with no row reads "Not recorded" with its reason; nothing
-- is written here by this migration, because no committed list states these
-- fields yet.
--
-- research_fund_directory_reports.vehicle_label names which vehicle a report
-- row observed, as the list labels it ("Opp", "V"). The rows written before
-- this carry NULL: they were keyed by manager and mix several vehicles, so the
-- profile never charts an unlabelled row as one vehicle's history.
--
-- Additive: a new table and a nullable column.

CREATE TABLE IF NOT EXISTS research_fund_vehicle_facts (
  fund_uid      TEXT NOT NULL,
  field         TEXT NOT NULL CHECK (field IN ('manager_name', 'investment_stage', 'investment_geography', 'initial_cheque')),
  value_text    TEXT,
  min_cents     INTEGER CHECK (min_cents IS NULL OR min_cents >= 0),
  max_cents     INTEGER CHECK (max_cents IS NULL OR max_cents >= 0),
  currency      TEXT CHECK (currency IS NULL OR currency IN ('EUR', 'USD', 'GBP')),
  source_name   TEXT NOT NULL,
  source_url    TEXT,
  reported_on   TEXT,
  imported_on   TEXT NOT NULL,
  PRIMARY KEY (fund_uid, field),
  -- A text field carries text; the cheque carries a range in a named currency.
  CHECK (
    (field = 'initial_cheque' AND value_text IS NULL AND currency IS NOT NULL
      AND (min_cents IS NOT NULL OR max_cents IS NOT NULL)
      AND (min_cents IS NULL OR max_cents IS NULL OR min_cents <= max_cents))
    OR
    (field <> 'initial_cheque' AND TRIM(COALESCE(value_text, '')) <> ''
      AND min_cents IS NULL AND max_cents IS NULL AND currency IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_research_fund_vehicle_facts_manager
    ON research_fund_vehicle_facts (field, value_text);

ALTER TABLE research_fund_directory_reports ADD COLUMN vehicle_label TEXT;
