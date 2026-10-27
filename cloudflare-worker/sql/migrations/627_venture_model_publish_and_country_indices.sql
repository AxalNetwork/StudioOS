-- 627 — venture scorecard part 6 (D1259, #3282, part 6 of #2428): who
-- published each model version and the recompute it started, and the country
-- indices model v1.1 reads. Assigned on #3282.
--
-- PUBLISHING. A model version is code (`services/ventureScoring/model.ts`);
-- publishing records that a Super Admin made it live. The live version is the
-- latest row here, and v1.0 scores until one exists. A publication then
-- recomputes every venture in batches (`cursor_project_id`), and each scope's
-- new row is a new row: the rows an earlier version wrote stay in
-- `venture_scorecards`, so a venture's history keeps them.
--
-- THE INDICES. An edition is one source's published release, imported once
-- and never edited; its values carry the licence it was imported under. The
-- reader counts a value only while that licence is still the one recorded
-- for its source in `countryIndex.ts` `INDEX_SOURCES` (D1259 §3): a source
-- without a recorded licence is neither imported nor read.
-- `country` is a `research_countries.code`, the code `markets.geography_ref`
-- holds: the country of a market a venture serves, never a person's.
--
-- `published_by` and `imported_by` keep the id without a foreign key, so the
-- record outlives the account (the pattern of the audit tables).
CREATE TABLE IF NOT EXISTS venture_model_publications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  version TEXT NOT NULL UNIQUE,
  published_by INTEGER NOT NULL,
  published_at TEXT NOT NULL,
  ventures_total INTEGER NOT NULL CHECK (ventures_total >= 0),
  ventures_done INTEGER NOT NULL DEFAULT 0 CHECK (ventures_done >= 0),
  ventures_failed INTEGER NOT NULL DEFAULT 0 CHECK (ventures_failed >= 0),
  cursor_project_id INTEGER NOT NULL DEFAULT 0,
  finished_at TEXT
);

CREATE TABLE IF NOT EXISTS country_index_editions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source TEXT NOT NULL CHECK (source IN ('wgi', 'fatf', 'eu_high_risk')),
  edition TEXT NOT NULL CHECK (length(trim(edition)) > 0),
  licence TEXT NOT NULL CHECK (length(trim(licence)) > 0),
  licence_decision TEXT NOT NULL CHECK (length(trim(licence_decision)) > 0),
  published_on TEXT NOT NULL CHECK (published_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  citation_url TEXT NOT NULL,
  value_count INTEGER NOT NULL CHECK (value_count >= 0),
  imported_by INTEGER NOT NULL,
  imported_at TEXT NOT NULL,
  UNIQUE (source, edition)
);

CREATE TABLE IF NOT EXISTS country_index_values (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source TEXT NOT NULL,
  edition TEXT NOT NULL,
  licence TEXT NOT NULL,
  country TEXT NOT NULL CHECK (length(country) = 2 AND country = upper(country)),
  indicator TEXT NOT NULL,
  value REAL NOT NULL CHECK (value >= 0 AND value <= 100),
  as_of TEXT NOT NULL,
  UNIQUE (source, edition, country, indicator),
  FOREIGN KEY (source, edition) REFERENCES country_index_editions(source, edition) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_country_index_values_country ON country_index_values(source, edition, country);
