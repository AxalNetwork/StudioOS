-- D7743 (#7743): Research › Funds — every source's statement about a fund, in
-- the source's own words.
--
-- research_fund_vehicle_facts (202611180053_7167) keys one value per fund and
-- field, holds four fields, and stores a cheque only as a min or max in EUR,
-- USD or GBP with no wording. It stays as it is and gets no writer. This store
-- holds what a source said: several sources for one fact, the wording, a
-- qualifier on an amount, a currency only when the source states one, and
-- stage and geography terms a filter can match
-- (services/researchFundObservations.ts reads and writes it).
--
-- research_fund_observations
--   fund_uid           a research_fund_directory uid, with no foreign key: a
--                      list's migration deletes and re-inserts its directory
--                      rows, and a cascade would delete other sources'
--                      statements. A uid that moved
--                      (research_fund_directory_uid_moves) is read under the
--                      new uid, one hop.
--   wording            always the source's text, never blank, at most 4,000
--                      characters.
--   source_name        the list, which must have a terms review row
--                      (research_fund_sources, D597).
--   source_record_ref  the staged record's id or a manifest's row key; opaque
--                      and never served.
--   period_start/end   set only when the statement is history.
--   promoted_by_user_id NULL when a migration wrote the row.
--   method             'rule' or 'manual', as researchTaxonomy.ts uses it.
--   Four money facts (initial_cheque, stated_fund_capital, manager_aum,
--   revenue_threshold) carry a qualifier, amounts in cents, a currency only
--   when it is stated or reviewed, the basis for that currency and any review
--   flags. Every other fact carries none of these.
--
-- research_fund_observation_terms
--   The vocabulary terms a statement's wording maps to: stage terms on an
--   investment_stage statement, country and region terms on an
--   investment_geography statement; the triggers below refuse any other pair.
--
-- Additive: two new tables, their indexes and three triggers. No rows.

CREATE TABLE IF NOT EXISTS research_fund_observations (
  id                  INTEGER PRIMARY KEY,
  fund_uid            TEXT NOT NULL CHECK (TRIM(fund_uid) <> ''),
  fact                TEXT NOT NULL CHECK (fact IN (
                        'manager_name', 'investment_stage', 'investment_geography', 'initial_cheque',
                        'stated_fund_capital', 'manager_aum', 'revenue_threshold', 'traction_requirement',
                        'lead_preference', 'interests', 'sector_focus', 'description', 'date_last_raised')),
  wording             TEXT NOT NULL CHECK (TRIM(wording) <> '' AND length(wording) <= 4000),
  source_name         TEXT NOT NULL REFERENCES research_fund_sources(source_name),
  source_url          TEXT,
  source_record_ref   TEXT NOT NULL CHECK (TRIM(source_record_ref) <> ''),
  reported_on         TEXT CHECK (reported_on IS NULL OR reported_on GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]'),
  period_start        TEXT CHECK (period_start IS NULL OR period_start GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]'),
  period_end          TEXT CHECK (period_end IS NULL OR period_end GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]'),
  imported_on         TEXT NOT NULL CHECK (imported_on GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]'),
  promoted_by_user_id INTEGER,
  promoted_at         TEXT,
  method              TEXT NOT NULL CHECK (method IN ('rule', 'manual')),
  qualifier           TEXT CHECK (qualifier IS NULL OR qualifier IN
                        ('range', 'typical', 'average_first', 'lower_bound', 'upper_bound', 'exact', 'as_stated')),
  min_cents           INTEGER CHECK (min_cents IS NULL OR min_cents >= 0),
  max_cents           INTEGER CHECK (max_cents IS NULL OR max_cents >= 0),
  point_cents         INTEGER CHECK (point_cents IS NULL OR point_cents >= 0),
  -- A shape, not a closed list: three capitals.
  currency            TEXT CHECK (currency IS NULL OR (length(currency) = 3 AND currency GLOB '[A-Z][A-Z][A-Z]')),
  currency_basis      TEXT CHECK (currency_basis IS NULL OR currency_basis IN
                        ('stated', 'symbol_only', 'heading_only', 'not_stated', 'conflicting', 'reviewed')),
  -- A JSON array of known flags, or NULL when there are none. Removing every
  -- known flag and every comma must leave exactly '[]'.
  review_flags        TEXT CHECK (review_flags IS NULL OR (
                        json_valid(review_flags) AND json_array_length(review_flags) >= 1
                        AND replace(replace(replace(replace(replace(replace(review_flags, ' ', ''),
                              '"two_units"', ''), '"symbol_heading_conflict"', ''), '"trailing_question_mark"', ''),
                              '"multiple_amounts"', ''), ',', '') = '[]')),
  UNIQUE (fund_uid, fact, source_name, source_record_ref),
  -- History has a period; a period runs forwards.
  CHECK (period_start IS NULL OR period_end IS NULL OR period_start <= period_end),
  -- A promoting user is recorded with the time of the promotion.
  CHECK (promoted_by_user_id IS NULL OR promoted_at IS NOT NULL),
  -- A text fact has no qualifier, amount, currency, basis or flag. A money
  -- fact has a qualifier and a basis, and exactly the amounts its qualifier names.
  CHECK (
    (fact NOT IN ('initial_cheque', 'stated_fund_capital', 'manager_aum', 'revenue_threshold')
      AND qualifier IS NULL AND min_cents IS NULL AND max_cents IS NULL AND point_cents IS NULL
      AND currency IS NULL AND currency_basis IS NULL AND review_flags IS NULL)
    OR
    (fact IN ('initial_cheque', 'stated_fund_capital', 'manager_aum', 'revenue_threshold')
      AND qualifier IS NOT NULL AND currency_basis IS NOT NULL
      AND (
        (qualifier = 'range' AND min_cents IS NOT NULL AND max_cents IS NOT NULL AND min_cents <= max_cents AND point_cents IS NULL)
        OR (qualifier IN ('typical', 'average_first', 'exact') AND point_cents IS NOT NULL AND min_cents IS NULL AND max_cents IS NULL)
        OR (qualifier = 'lower_bound' AND min_cents IS NOT NULL AND max_cents IS NULL AND point_cents IS NULL)
        OR (qualifier = 'upper_bound' AND max_cents IS NOT NULL AND min_cents IS NULL AND point_cents IS NULL)
        OR (qualifier = 'as_stated' AND min_cents IS NULL AND max_cents IS NULL AND point_cents IS NULL)))
  ),
  -- A currency code is present when, and only when, the basis is stated or reviewed.
  CHECK (currency_basis IS NULL OR ((currency IS NOT NULL) = (currency_basis IN ('stated', 'reviewed')))),
  -- A flagged row keeps its wording and no amounts.
  CHECK (review_flags IS NULL OR qualifier = 'as_stated')
);

CREATE INDEX IF NOT EXISTS idx_research_fund_observations_fact_fund
    ON research_fund_observations (fact, fund_uid);

CREATE TABLE IF NOT EXISTS research_fund_observation_terms (
  observation_id INTEGER NOT NULL REFERENCES research_fund_observations(id) ON DELETE CASCADE,
  vocabulary     TEXT NOT NULL CHECK (vocabulary IN ('stage', 'country', 'region')),
  term           TEXT NOT NULL CHECK (TRIM(term) <> ''
                   AND (vocabulary <> 'country' OR (length(term) = 2 AND term GLOB '[A-Z][A-Z]'))),
  PRIMARY KEY (observation_id, vocabulary, term)
);

CREATE INDEX IF NOT EXISTS idx_research_fund_observation_terms_term
    ON research_fund_observation_terms (vocabulary, term);

-- A stage term belongs to an investment_stage statement; a country or region
-- term to an investment_geography statement.
CREATE TRIGGER IF NOT EXISTS research_fund_observation_terms_fact_insert
BEFORE INSERT ON research_fund_observation_terms
WHEN NOT EXISTS (
  SELECT 1 FROM research_fund_observations o
   WHERE o.id = NEW.observation_id
     AND ((NEW.vocabulary = 'stage' AND o.fact = 'investment_stage')
       OR (NEW.vocabulary IN ('country', 'region') AND o.fact = 'investment_geography')))
BEGIN
  SELECT RAISE(ABORT, 'research_fund_observation_terms.vocabulary: a stage term needs an investment_stage statement, a country or region term an investment_geography statement');
END;

-- The same rule when a term row is moved or relabelled.
CREATE TRIGGER IF NOT EXISTS research_fund_observation_terms_fact_update
BEFORE UPDATE OF observation_id, vocabulary ON research_fund_observation_terms
WHEN NOT EXISTS (
  SELECT 1 FROM research_fund_observations o
   WHERE o.id = NEW.observation_id
     AND ((NEW.vocabulary = 'stage' AND o.fact = 'investment_stage')
       OR (NEW.vocabulary IN ('country', 'region') AND o.fact = 'investment_geography')))
BEGIN
  SELECT RAISE(ABORT, 'research_fund_observation_terms.vocabulary: a stage term needs an investment_stage statement, a country or region term an investment_geography statement');
END;

-- A statement's fact never changes, so its terms cannot end up on the wrong fact.
CREATE TRIGGER IF NOT EXISTS research_fund_observations_fact_fixed
BEFORE UPDATE OF fact ON research_fund_observations
WHEN NEW.fact <> OLD.fact
BEGIN
  SELECT RAISE(ABORT, 'research_fund_observations.fact: a statement''s fact never changes; write a new statement');
END;
