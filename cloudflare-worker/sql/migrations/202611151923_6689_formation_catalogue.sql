-- D6689 (#6689, plan key C1 of #6680) — the formation catalogue: countries
-- as data, not code. This file creates the empty store; nothing reads it in
-- production yet and no fact is inserted here (the seed is #6690, the first
-- reader #6691, the editor #6699). Every database gets the tables; after
-- version 1, versions are written in HQ's database only (owner decision 8).
--
-- VERSIONS. `formation_catalogue_versions` holds draft, in_review, published
-- and retired versions. At most one is current (a partial unique index), and
-- only a published version can be current. A published or retired version is
-- immutable: its row may only move published → retired and lose or gain
-- "current", and the rows of every versioned table below refuse an INSERT,
-- UPDATE or DELETE that touches a version which is not a draft or in review.
--
-- NO FIGURE WITHOUT A SOURCE AND A DAY (D4357). A fact is `recorded` only with
-- a source and `checked_on`; a fee line with an amount has both too. Amounts
-- are integer minor units of `currency` (`amount_cents`); NULL is "not
-- recorded", never 0.
--
-- New tables, so CHECKs are used directly; no existing table is rebuilt.
-- STANDS ALONE under the runner: no BEGIN/COMMIT outside trigger bodies.

CREATE TABLE IF NOT EXISTS formation_catalogue_versions (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  version       INTEGER NOT NULL UNIQUE CHECK (typeof(version) = 'integer' AND version >= 1),
  status        TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'in_review', 'published', 'retired')),
  is_current    INTEGER NOT NULL DEFAULT 0 CHECK (is_current IN (0, 1)),
  notes         TEXT CHECK (notes IS NULL OR length(notes) <= 4000),
  created_by    INTEGER,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  published_by  INTEGER,
  published_at  TEXT,
  retired_at    TEXT,
  CHECK (is_current = 0 OR status = 'published'),
  CHECK (status NOT IN ('published', 'retired') OR (published_by IS NOT NULL AND published_at IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_formation_catalogue_versions_current
  ON formation_catalogue_versions (is_current) WHERE is_current = 1;

-- A published or retired version changes only its status (published → retired) and whether it is current.
CREATE TRIGGER IF NOT EXISTS formation_catalogue_versions_published_immutable
BEFORE UPDATE ON formation_catalogue_versions
WHEN OLD.status IN ('published', 'retired') AND (
     NEW.version IS NOT OLD.version OR NEW.notes IS NOT OLD.notes
  OR NEW.created_by IS NOT OLD.created_by OR NEW.created_at IS NOT OLD.created_at
  OR NEW.published_by IS NOT OLD.published_by OR NEW.published_at IS NOT OLD.published_at
  OR NOT (NEW.status = OLD.status OR (OLD.status = 'published' AND NEW.status = 'retired')))
BEGIN
  SELECT RAISE(ABORT, 'formation_catalogue_versions: a published version is immutable (D6689).');
END;
CREATE TRIGGER IF NOT EXISTS formation_catalogue_versions_published_no_delete
BEFORE DELETE ON formation_catalogue_versions
WHEN OLD.status IN ('published', 'retired')
BEGIN
  SELECT RAISE(ABORT, 'formation_catalogue_versions: a published version is never deleted (D6689).');
END;

-- Sources and their checks are not versioned: a version cites them.
CREATE TABLE IF NOT EXISTS formation_sources (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  kind          TEXT NOT NULL CHECK (kind IN ('statute', 'registry', 'regulator', 'tax_authority', 'counsel', 'provider', 'other')),
  title         TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 300),
  url           TEXT CHECK (url IS NULL OR (length(url) <= 2000 AND url LIKE 'https://%')),
  publisher     TEXT CHECK (publisher IS NULL OR length(publisher) <= 200),
  created_by    INTEGER,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE TABLE IF NOT EXISTS formation_source_checks (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  source_id     INTEGER NOT NULL REFERENCES formation_sources(id),
  checked_on    TEXT NOT NULL CHECK (checked_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  checked_by    INTEGER NOT NULL,
  outcome       TEXT NOT NULL CHECK (outcome IN ('unchanged', 'changed', 'unreachable')),
  note          TEXT CHECK (note IS NULL OR length(note) <= 2000),
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
CREATE INDEX IF NOT EXISTS ix_formation_source_checks_source ON formation_source_checks (source_id, checked_on);

CREATE TABLE IF NOT EXISTS formation_jurisdictions (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  version_id       INTEGER NOT NULL REFERENCES formation_catalogue_versions(id),
  country          TEXT NOT NULL CHECK (length(country) = 2 AND country = upper(country) AND country GLOB '[A-Z][A-Z]'),
  subdivision      TEXT CHECK (subdivision IS NULL OR length(subdivision) BETWEEN 1 AND 6),
  registry_name    TEXT CHECK (registry_name IS NULL OR length(registry_name) <= 200),
  vocabulary_json  TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(vocabulary_json))
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_formation_jurisdictions_place
  ON formation_jurisdictions (version_id, country, COALESCE(subdivision, ''));

CREATE TABLE IF NOT EXISTS formation_entity_forms (
  id                     INTEGER PRIMARY KEY AUTOINCREMENT,
  version_id             INTEGER NOT NULL REFERENCES formation_catalogue_versions(id),
  jurisdiction_id        INTEGER NOT NULL REFERENCES formation_jurisdictions(id),
  form_key               TEXT NOT NULL CHECK (length(form_key) BETWEEN 1 AND 64 AND form_key NOT GLOB '*[^a-z0-9_]*'),
  label                  TEXT NOT NULL CHECK (length(label) BETWEEN 1 AND 200),
  offer_mode             TEXT NOT NULL DEFAULT 'off' CHECK (offer_mode IN ('orderable', 'guided', 'information_only', 'off')),
  legal_form_family      TEXT CHECK (legal_form_family IS NULL OR length(legal_form_family) <= 64),
  legacy_gate            TEXT CHECK (legacy_gate IS NULL OR length(legacy_gate) <= 64),
  legacy_display_json    TEXT CHECK (legacy_display_json IS NULL OR json_valid(legacy_display_json)),
  allow_axal_collection  INTEGER NOT NULL DEFAULT 0 CHECK (allow_axal_collection IN (0, 1)),
  UNIQUE (version_id, form_key)
);
CREATE INDEX IF NOT EXISTS ix_formation_entity_forms_jurisdiction ON formation_entity_forms (jurisdiction_id);

CREATE TABLE IF NOT EXISTS formation_form_facts (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  version_id    INTEGER NOT NULL REFERENCES formation_catalogue_versions(id),
  form_id       INTEGER NOT NULL REFERENCES formation_entity_forms(id),
  fact_key      TEXT NOT NULL CHECK (length(fact_key) BETWEEN 1 AND 64),
  value         TEXT CHECK (value IS NULL OR length(value) <= 2000),
  status        TEXT NOT NULL DEFAULT 'not_recorded' CHECK (status IN ('recorded', 'provisional', 'not_recorded', 'disputed')),
  blocking      INTEGER NOT NULL DEFAULT 0 CHECK (blocking IN (0, 1)),
  source_id     INTEGER REFERENCES formation_sources(id),
  checked_on    TEXT CHECK (checked_on IS NULL OR checked_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  checked_by    INTEGER,
  CHECK (status <> 'recorded' OR (source_id IS NOT NULL AND checked_on IS NOT NULL AND value IS NOT NULL)),
  UNIQUE (form_id, fact_key)
);

CREATE TABLE IF NOT EXISTS formation_fee_lines (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  version_id     INTEGER NOT NULL REFERENCES formation_catalogue_versions(id),
  form_id        INTEGER NOT NULL REFERENCES formation_entity_forms(id),
  line_key       TEXT NOT NULL CHECK (length(line_key) BETWEEN 1 AND 64),
  label          TEXT NOT NULL CHECK (length(label) BETWEEN 1 AND 200),
  payee          TEXT NOT NULL CHECK (length(payee) BETWEEN 1 AND 200),
  collected_by   TEXT NOT NULL CHECK (collected_by IN ('axal', 'payee', 'provider')),
  currency       TEXT NOT NULL CHECK (length(currency) = 3 AND currency = upper(currency)),
  amount_cents   INTEGER CHECK (amount_cents IS NULL OR (typeof(amount_cents) = 'integer' AND amount_cents >= 0)),
  timing         TEXT NOT NULL CHECK (timing IN ('at_formation', 'annual', 'one_off', 'on_event')),
  source_id      INTEGER REFERENCES formation_sources(id),
  checked_on     TEXT CHECK (checked_on IS NULL OR checked_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  checked_by     INTEGER,
  CHECK (amount_cents IS NULL OR (source_id IS NOT NULL AND checked_on IS NOT NULL)),
  UNIQUE (form_id, line_key)
);

CREATE TABLE IF NOT EXISTS formation_pack_items (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  version_id        INTEGER NOT NULL REFERENCES formation_catalogue_versions(id),
  form_id           INTEGER NOT NULL REFERENCES formation_entity_forms(id),
  item_key          TEXT NOT NULL CHECK (length(item_key) BETWEEN 1 AND 64),
  phase             TEXT NOT NULL CHECK (phase IN ('before_filing', 'filing', 'after_filing')),
  kind              TEXT NOT NULL CHECK (kind IN ('document', 'filing', 'registration', 'step')),
  acting_party      TEXT NOT NULL CHECK (acting_party IN ('founder', 'axal', 'counsel', 'provider', 'registry')),
  title             TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  template_key      TEXT CHECK (template_key IS NULL OR length(template_key) <= 64),
  counsel_required  INTEGER NOT NULL DEFAULT 1 CHECK (counsel_required IN (0, 1)),
  position          INTEGER NOT NULL DEFAULT 0,
  UNIQUE (form_id, item_key)
);

-- The intake questions a form asks.
CREATE TABLE IF NOT EXISTS formation_fact_schema (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  version_id    INTEGER NOT NULL REFERENCES formation_catalogue_versions(id),
  form_id       INTEGER REFERENCES formation_entity_forms(id),
  question_key  TEXT NOT NULL CHECK (length(question_key) BETWEEN 1 AND 64),
  label         TEXT NOT NULL CHECK (length(label) BETWEEN 1 AND 300),
  answer_kind   TEXT NOT NULL CHECK (answer_kind IN ('text', 'number', 'date', 'choice', 'boolean', 'person', 'address')),
  options_json  TEXT CHECK (options_json IS NULL OR json_valid(options_json)),
  required      INTEGER NOT NULL DEFAULT 1 CHECK (required IN (0, 1)),
  position      INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_formation_fact_schema_question
  ON formation_fact_schema (version_id, COALESCE(form_id, 0), question_key);

CREATE TABLE IF NOT EXISTS formation_scenarios (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  version_id      INTEGER NOT NULL REFERENCES formation_catalogue_versions(id),
  form_id         INTEGER NOT NULL REFERENCES formation_entity_forms(id),
  scenario_key    TEXT NOT NULL CHECK (length(scenario_key) BETWEEN 1 AND 64),
  route           TEXT NOT NULL CHECK (route IN ('axal_files', 'provider_files', 'founder_files', 'refer_counsel', 'not_offered')),
  waiver_allowed  INTEGER NOT NULL DEFAULT 0 CHECK (waiver_allowed IN (0, 1)),
  conditions_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(conditions_json)),
  UNIQUE (form_id, scenario_key)
);

CREATE TABLE IF NOT EXISTS formation_rules (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  version_id    INTEGER NOT NULL REFERENCES formation_catalogue_versions(id),
  rule_key      TEXT NOT NULL CHECK (length(rule_key) BETWEEN 1 AND 64),
  kind          TEXT NOT NULL CHECK (kind IN ('recommend', 'block', 'require', 'warn')),
  rule_json     TEXT NOT NULL CHECK (json_valid(rule_json)),
  position      INTEGER NOT NULL DEFAULT 0,
  UNIQUE (version_id, rule_key)
);

-- Places Axal does not form in, or forms in only with conditions. Not versioned.
CREATE TABLE IF NOT EXISTS formation_restricted_jurisdictions (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  place         TEXT NOT NULL CHECK (length(place) BETWEEN 2 AND 12),
  kind          TEXT NOT NULL CHECK (kind IN ('sanctioned', 'not_served', 'counsel_only')),
  source_id     INTEGER NOT NULL REFERENCES formation_sources(id),
  checked_on    TEXT NOT NULL CHECK (checked_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  checked_by    INTEGER NOT NULL,
  note          TEXT CHECK (note IS NULL OR length(note) <= 2000),
  UNIQUE (place, kind)
);

-- A published or retired version's rows never change: each versioned table refuses
-- an INSERT, UPDATE or DELETE naming a version that is not a draft or in review
-- (or no version at all). A form, fact, fee line, pack item, scenario or question
-- belongs to the same version as the row it hangs from.
CREATE TRIGGER IF NOT EXISTS formation_jurisdictions_frozen_insert BEFORE INSERT ON formation_jurisdictions
WHEN COALESCE((SELECT status FROM formation_catalogue_versions WHERE id = NEW.version_id), 'missing') NOT IN ('draft', 'in_review')
BEGIN SELECT RAISE(ABORT, 'formation_jurisdictions: a published version is immutable (D6689).'); END;
CREATE TRIGGER IF NOT EXISTS formation_jurisdictions_frozen_update BEFORE UPDATE ON formation_jurisdictions
WHEN COALESCE((SELECT status FROM formation_catalogue_versions WHERE id = OLD.version_id), 'missing') NOT IN ('draft', 'in_review')
  OR COALESCE((SELECT status FROM formation_catalogue_versions WHERE id = NEW.version_id), 'missing') NOT IN ('draft', 'in_review')
BEGIN SELECT RAISE(ABORT, 'formation_jurisdictions: a published version is immutable (D6689).'); END;
CREATE TRIGGER IF NOT EXISTS formation_jurisdictions_frozen_delete BEFORE DELETE ON formation_jurisdictions
WHEN COALESCE((SELECT status FROM formation_catalogue_versions WHERE id = OLD.version_id), 'missing') NOT IN ('draft', 'in_review')
BEGIN SELECT RAISE(ABORT, 'formation_jurisdictions: a published version is immutable (D6689).'); END;

CREATE TRIGGER IF NOT EXISTS formation_entity_forms_frozen_insert BEFORE INSERT ON formation_entity_forms
WHEN COALESCE((SELECT status FROM formation_catalogue_versions WHERE id = NEW.version_id), 'missing') NOT IN ('draft', 'in_review')
  OR (NEW.jurisdiction_id IS NOT NULL AND NEW.version_id IS NOT (SELECT version_id FROM formation_jurisdictions WHERE id = NEW.jurisdiction_id))
BEGIN SELECT RAISE(ABORT, 'formation_entity_forms: a published version is immutable, and a row belongs to its parent''s version (D6689).'); END;
CREATE TRIGGER IF NOT EXISTS formation_entity_forms_frozen_update BEFORE UPDATE ON formation_entity_forms
WHEN COALESCE((SELECT status FROM formation_catalogue_versions WHERE id = OLD.version_id), 'missing') NOT IN ('draft', 'in_review')
  OR COALESCE((SELECT status FROM formation_catalogue_versions WHERE id = NEW.version_id), 'missing') NOT IN ('draft', 'in_review')
  OR (NEW.jurisdiction_id IS NOT NULL AND NEW.version_id IS NOT (SELECT version_id FROM formation_jurisdictions WHERE id = NEW.jurisdiction_id))
BEGIN SELECT RAISE(ABORT, 'formation_entity_forms: a published version is immutable, and a row belongs to its parent''s version (D6689).'); END;
CREATE TRIGGER IF NOT EXISTS formation_entity_forms_frozen_delete BEFORE DELETE ON formation_entity_forms
WHEN COALESCE((SELECT status FROM formation_catalogue_versions WHERE id = OLD.version_id), 'missing') NOT IN ('draft', 'in_review')
BEGIN SELECT RAISE(ABORT, 'formation_entity_forms: a published version is immutable (D6689).'); END;

CREATE TRIGGER IF NOT EXISTS formation_form_facts_frozen_insert BEFORE INSERT ON formation_form_facts
WHEN COALESCE((SELECT status FROM formation_catalogue_versions WHERE id = NEW.version_id), 'missing') NOT IN ('draft', 'in_review')
  OR (NEW.form_id IS NOT NULL AND NEW.version_id IS NOT (SELECT version_id FROM formation_entity_forms WHERE id = NEW.form_id))
BEGIN SELECT RAISE(ABORT, 'formation_form_facts: a published version is immutable, and a row belongs to its parent''s version (D6689).'); END;
CREATE TRIGGER IF NOT EXISTS formation_form_facts_frozen_update BEFORE UPDATE ON formation_form_facts
WHEN COALESCE((SELECT status FROM formation_catalogue_versions WHERE id = OLD.version_id), 'missing') NOT IN ('draft', 'in_review')
  OR COALESCE((SELECT status FROM formation_catalogue_versions WHERE id = NEW.version_id), 'missing') NOT IN ('draft', 'in_review')
  OR (NEW.form_id IS NOT NULL AND NEW.version_id IS NOT (SELECT version_id FROM formation_entity_forms WHERE id = NEW.form_id))
BEGIN SELECT RAISE(ABORT, 'formation_form_facts: a published version is immutable, and a row belongs to its parent''s version (D6689).'); END;
CREATE TRIGGER IF NOT EXISTS formation_form_facts_frozen_delete BEFORE DELETE ON formation_form_facts
WHEN COALESCE((SELECT status FROM formation_catalogue_versions WHERE id = OLD.version_id), 'missing') NOT IN ('draft', 'in_review')
BEGIN SELECT RAISE(ABORT, 'formation_form_facts: a published version is immutable (D6689).'); END;

CREATE TRIGGER IF NOT EXISTS formation_fee_lines_frozen_insert BEFORE INSERT ON formation_fee_lines
WHEN COALESCE((SELECT status FROM formation_catalogue_versions WHERE id = NEW.version_id), 'missing') NOT IN ('draft', 'in_review')
  OR (NEW.form_id IS NOT NULL AND NEW.version_id IS NOT (SELECT version_id FROM formation_entity_forms WHERE id = NEW.form_id))
BEGIN SELECT RAISE(ABORT, 'formation_fee_lines: a published version is immutable, and a row belongs to its parent''s version (D6689).'); END;
CREATE TRIGGER IF NOT EXISTS formation_fee_lines_frozen_update BEFORE UPDATE ON formation_fee_lines
WHEN COALESCE((SELECT status FROM formation_catalogue_versions WHERE id = OLD.version_id), 'missing') NOT IN ('draft', 'in_review')
  OR COALESCE((SELECT status FROM formation_catalogue_versions WHERE id = NEW.version_id), 'missing') NOT IN ('draft', 'in_review')
  OR (NEW.form_id IS NOT NULL AND NEW.version_id IS NOT (SELECT version_id FROM formation_entity_forms WHERE id = NEW.form_id))
BEGIN SELECT RAISE(ABORT, 'formation_fee_lines: a published version is immutable, and a row belongs to its parent''s version (D6689).'); END;
CREATE TRIGGER IF NOT EXISTS formation_fee_lines_frozen_delete BEFORE DELETE ON formation_fee_lines
WHEN COALESCE((SELECT status FROM formation_catalogue_versions WHERE id = OLD.version_id), 'missing') NOT IN ('draft', 'in_review')
BEGIN SELECT RAISE(ABORT, 'formation_fee_lines: a published version is immutable (D6689).'); END;

CREATE TRIGGER IF NOT EXISTS formation_pack_items_frozen_insert BEFORE INSERT ON formation_pack_items
WHEN COALESCE((SELECT status FROM formation_catalogue_versions WHERE id = NEW.version_id), 'missing') NOT IN ('draft', 'in_review')
  OR (NEW.form_id IS NOT NULL AND NEW.version_id IS NOT (SELECT version_id FROM formation_entity_forms WHERE id = NEW.form_id))
BEGIN SELECT RAISE(ABORT, 'formation_pack_items: a published version is immutable, and a row belongs to its parent''s version (D6689).'); END;
CREATE TRIGGER IF NOT EXISTS formation_pack_items_frozen_update BEFORE UPDATE ON formation_pack_items
WHEN COALESCE((SELECT status FROM formation_catalogue_versions WHERE id = OLD.version_id), 'missing') NOT IN ('draft', 'in_review')
  OR COALESCE((SELECT status FROM formation_catalogue_versions WHERE id = NEW.version_id), 'missing') NOT IN ('draft', 'in_review')
  OR (NEW.form_id IS NOT NULL AND NEW.version_id IS NOT (SELECT version_id FROM formation_entity_forms WHERE id = NEW.form_id))
BEGIN SELECT RAISE(ABORT, 'formation_pack_items: a published version is immutable, and a row belongs to its parent''s version (D6689).'); END;
CREATE TRIGGER IF NOT EXISTS formation_pack_items_frozen_delete BEFORE DELETE ON formation_pack_items
WHEN COALESCE((SELECT status FROM formation_catalogue_versions WHERE id = OLD.version_id), 'missing') NOT IN ('draft', 'in_review')
BEGIN SELECT RAISE(ABORT, 'formation_pack_items: a published version is immutable (D6689).'); END;

CREATE TRIGGER IF NOT EXISTS formation_fact_schema_frozen_insert BEFORE INSERT ON formation_fact_schema
WHEN COALESCE((SELECT status FROM formation_catalogue_versions WHERE id = NEW.version_id), 'missing') NOT IN ('draft', 'in_review')
  OR (NEW.form_id IS NOT NULL AND NEW.version_id IS NOT (SELECT version_id FROM formation_entity_forms WHERE id = NEW.form_id))
BEGIN SELECT RAISE(ABORT, 'formation_fact_schema: a published version is immutable, and a row belongs to its parent''s version (D6689).'); END;
CREATE TRIGGER IF NOT EXISTS formation_fact_schema_frozen_update BEFORE UPDATE ON formation_fact_schema
WHEN COALESCE((SELECT status FROM formation_catalogue_versions WHERE id = OLD.version_id), 'missing') NOT IN ('draft', 'in_review')
  OR COALESCE((SELECT status FROM formation_catalogue_versions WHERE id = NEW.version_id), 'missing') NOT IN ('draft', 'in_review')
  OR (NEW.form_id IS NOT NULL AND NEW.version_id IS NOT (SELECT version_id FROM formation_entity_forms WHERE id = NEW.form_id))
BEGIN SELECT RAISE(ABORT, 'formation_fact_schema: a published version is immutable, and a row belongs to its parent''s version (D6689).'); END;
CREATE TRIGGER IF NOT EXISTS formation_fact_schema_frozen_delete BEFORE DELETE ON formation_fact_schema
WHEN COALESCE((SELECT status FROM formation_catalogue_versions WHERE id = OLD.version_id), 'missing') NOT IN ('draft', 'in_review')
BEGIN SELECT RAISE(ABORT, 'formation_fact_schema: a published version is immutable (D6689).'); END;

CREATE TRIGGER IF NOT EXISTS formation_scenarios_frozen_insert BEFORE INSERT ON formation_scenarios
WHEN COALESCE((SELECT status FROM formation_catalogue_versions WHERE id = NEW.version_id), 'missing') NOT IN ('draft', 'in_review')
  OR (NEW.form_id IS NOT NULL AND NEW.version_id IS NOT (SELECT version_id FROM formation_entity_forms WHERE id = NEW.form_id))
BEGIN SELECT RAISE(ABORT, 'formation_scenarios: a published version is immutable, and a row belongs to its parent''s version (D6689).'); END;
CREATE TRIGGER IF NOT EXISTS formation_scenarios_frozen_update BEFORE UPDATE ON formation_scenarios
WHEN COALESCE((SELECT status FROM formation_catalogue_versions WHERE id = OLD.version_id), 'missing') NOT IN ('draft', 'in_review')
  OR COALESCE((SELECT status FROM formation_catalogue_versions WHERE id = NEW.version_id), 'missing') NOT IN ('draft', 'in_review')
  OR (NEW.form_id IS NOT NULL AND NEW.version_id IS NOT (SELECT version_id FROM formation_entity_forms WHERE id = NEW.form_id))
BEGIN SELECT RAISE(ABORT, 'formation_scenarios: a published version is immutable, and a row belongs to its parent''s version (D6689).'); END;
CREATE TRIGGER IF NOT EXISTS formation_scenarios_frozen_delete BEFORE DELETE ON formation_scenarios
WHEN COALESCE((SELECT status FROM formation_catalogue_versions WHERE id = OLD.version_id), 'missing') NOT IN ('draft', 'in_review')
BEGIN SELECT RAISE(ABORT, 'formation_scenarios: a published version is immutable (D6689).'); END;

CREATE TRIGGER IF NOT EXISTS formation_rules_frozen_insert BEFORE INSERT ON formation_rules
WHEN COALESCE((SELECT status FROM formation_catalogue_versions WHERE id = NEW.version_id), 'missing') NOT IN ('draft', 'in_review')
BEGIN SELECT RAISE(ABORT, 'formation_rules: a published version is immutable (D6689).'); END;
CREATE TRIGGER IF NOT EXISTS formation_rules_frozen_update BEFORE UPDATE ON formation_rules
WHEN COALESCE((SELECT status FROM formation_catalogue_versions WHERE id = OLD.version_id), 'missing') NOT IN ('draft', 'in_review')
  OR COALESCE((SELECT status FROM formation_catalogue_versions WHERE id = NEW.version_id), 'missing') NOT IN ('draft', 'in_review')
BEGIN SELECT RAISE(ABORT, 'formation_rules: a published version is immutable (D6689).'); END;
CREATE TRIGGER IF NOT EXISTS formation_rules_frozen_delete BEFORE DELETE ON formation_rules
WHEN COALESCE((SELECT status FROM formation_catalogue_versions WHERE id = OLD.version_id), 'missing') NOT IN ('draft', 'in_review')
BEGIN SELECT RAISE(ABORT, 'formation_rules: a published version is immutable (D6689).'); END;
