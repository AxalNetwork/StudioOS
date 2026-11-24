-- D7828 (#7828): Research › Companies — sourced business facts about a company.
--
-- research_company_facts holds what a source says a business does: one row per
-- fact, keyed on the company's uid and a stable key the reviewed manifest gives
-- it. scripts/import-company-facts.mjs compiles that manifest into a migration
-- and is the only writer; services/researchCompanyFacts.ts reads it.
--
--   company_uid       a research_company_directory uid, with no foreign key: an
--                     importer deletes and re-inserts directory rows, and a
--                     cascade would delete reviewed facts.
--   fact_key          stable within its company, so a replay writes nothing.
--   attribute         the closed list of D7828.
--   statement_type    who is speaking (researchEvidenceVocabulary.ts); not an
--                     observation's actual, estimate or forecast status.
--   publisher         as the source names it; the read joins
--                     research_company_publishers (D7810) for its licence.
--   passage           a short capped quotation, never a page; or source_field,
--                     the structured field a registry fact was read from.
--   market_country    on a 'markets served' fact naming one country, the code
--                     from the taxonomy crosswalk (researchTaxonomy.ts).
--   state             found, or an absence (not_found, not_offered,
--                     source_unavailable) that names the source checked and
--                     when and carries no value; outdated once replaced.
--   conflicts_with_key, replaces_key, replaced_by_key
--                     fact_keys of the same company.
--   reviewed_by       from the manifest; no member read selects it.
--   manifest_name     the compiled manifest that wrote the row, so skipped
--                     facts are counted after deploy against its header.
--
-- Value, passage and source are never edited: the trigger lets an UPDATE only
-- mark a fact outdated and link its replacement once. Additive: one table, one
-- index and one trigger. No rows.

CREATE TABLE IF NOT EXISTS research_company_facts (
  id                 INTEGER PRIMARY KEY,
  company_uid        TEXT NOT NULL CHECK (TRIM(company_uid) <> '' AND length(company_uid) <= 64),
  fact_key           TEXT NOT NULL CHECK (TRIM(fact_key) <> '' AND length(fact_key) <= 128),
  attribute          TEXT NOT NULL CHECK (attribute IN (
                       'product', 'capability', 'use_case', 'buyer', 'customer_segment', 'markets_served',
                       'business_model', 'delivery_model', 'pricing_model', 'partner_programme',
                       'integration_listing', 'contact_path')),
  value              TEXT CHECK (value IS NULL OR (TRIM(value) <> '' AND length(value) <= 300)),
  statement_type     TEXT NOT NULL CHECK (statement_type IN (
                       'company_statement', 'registry_fact', 'third_party_observation', 'analyst_interpretation')),
  source_url         TEXT NOT NULL CHECK (source_url GLOB 'https://?*'),
  publisher          TEXT NOT NULL CHECK (TRIM(publisher) <> '' AND length(publisher) <= 200),
  passage            TEXT CHECK (passage IS NULL OR (TRIM(passage) <> '' AND length(passage) <= 400)),
  source_field       TEXT CHECK (source_field IS NULL OR (TRIM(source_field) <> '' AND length(source_field) <= 120)),
  market_country     TEXT CHECK (market_country IS NULL OR (attribute = 'markets_served'
                       AND market_country GLOB '[A-Z][A-Z]')),
  published_at       TEXT CHECK (published_at IS NULL OR date(published_at) IS NOT NULL),
  retrieved_at       TEXT NOT NULL CHECK (date(retrieved_at) IS NOT NULL),
  reviewed_at        TEXT NOT NULL CHECK (date(reviewed_at) IS NOT NULL),
  reviewed_by        TEXT NOT NULL CHECK (TRIM(reviewed_by) <> ''),
  state              TEXT NOT NULL CHECK (state IN (
                       'found', 'not_found', 'not_offered', 'source_unavailable', 'outdated')),
  conflicts_with_key TEXT,
  replaces_key       TEXT,
  replaced_by_key    TEXT,
  manifest_name      TEXT NOT NULL CHECK (TRIM(manifest_name) <> ''),
  -- A found fact has a value and a passage or a field.
  CHECK (state <> 'found' OR (value IS NOT NULL AND (passage IS NOT NULL OR source_field IS NOT NULL))),
  -- An absence carries no value.
  CHECK (state NOT IN ('not_found', 'not_offered', 'source_unavailable')
    OR (value IS NULL AND passage IS NULL AND source_field IS NULL AND market_country IS NULL)),
  -- A contact or application path is the link of a published page.
  CHECK (attribute <> 'contact_path' OR value IS NULL OR value GLOB 'https://?*'),
  CHECK (replaced_by_key IS NULL OR state = 'outdated'),
  UNIQUE (company_uid, fact_key)
);

CREATE INDEX IF NOT EXISTS idx_research_company_facts_company
  ON research_company_facts(company_uid, attribute);

CREATE TRIGGER IF NOT EXISTS research_company_facts_kept
BEFORE UPDATE ON research_company_facts
WHEN NOT (
  NEW.id IS OLD.id AND NEW.company_uid IS OLD.company_uid AND NEW.fact_key IS OLD.fact_key
  AND NEW.attribute IS OLD.attribute AND NEW.value IS OLD.value AND NEW.statement_type IS OLD.statement_type
  AND NEW.source_url IS OLD.source_url AND NEW.publisher IS OLD.publisher AND NEW.passage IS OLD.passage
  AND NEW.source_field IS OLD.source_field AND NEW.market_country IS OLD.market_country
  AND NEW.published_at IS OLD.published_at AND NEW.retrieved_at IS OLD.retrieved_at
  AND NEW.reviewed_at IS OLD.reviewed_at AND NEW.reviewed_by IS OLD.reviewed_by
  AND NEW.conflicts_with_key IS OLD.conflicts_with_key AND NEW.replaces_key IS OLD.replaces_key
  AND NEW.manifest_name IS OLD.manifest_name
  AND (NEW.state IS OLD.state OR NEW.state = 'outdated')
  AND (NEW.replaced_by_key IS OLD.replaced_by_key OR OLD.replaced_by_key IS NULL)
)
BEGIN
  SELECT RAISE(ABORT, 'research_company_facts: value, passage and source are never edited; a correction is a new fact');
END;
