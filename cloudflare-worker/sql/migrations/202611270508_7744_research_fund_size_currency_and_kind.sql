-- D7744 (#7744): a catalogue row carries its own size currency and record kind.
--
-- Before this, the Worker decided a size's currency from the row's list name
-- (LIST_CURRENCY: EuroTech in euros, Shai Goldman in US dollars) and every
-- other list's size was nulled on read; nothing said whether a row was a fund
-- vehicle or a manager. Now each row says both, and the reads use the row.
--
--   research_fund_directory.fund_size_currency          three capitals, or NULL
--   research_fund_directory.record_kind                 vehicle | manager | accelerator | resource, or NULL
--   research_fund_directory_reports.fund_size_currency  three capitals, or NULL
--   research_fund_list_defaults                         each list's kind and size currency
--
-- The allowed values are checked by triggers, not CHECK constraints, so a later
-- migration can widen the set by replacing a trigger, without a table rebuild.
--
-- The list table names only the lists whose kind and currency are known: the
-- two vehicle lists and the three manager lists of #7326, PR #7337 (migration
-- 202611181350_7325) and PR #7586 (migration 202611190015_7585), by the source
-- names those merged migrations write. The Deep Tech mapping is not listed, so
-- its rows keep NULL for both. A currency is set only where a size is present;
-- sizes are never converted.
--
-- Insert triggers stamp a row of a listed list that arrives with no kind, or
-- with a size and no currency, so a re-import that does not name the new
-- columns (scripts/import-research-funds.py writes INSERT OR REPLACE) cannot
-- blank them. A row of an unlisted list is never stamped. Additive: nothing is
-- dropped, no size changes.
-- forward-fix: cloudflare-worker/sql/forward-fixes/202611270508_7744_research_fund_size_currency_and_kind.fix.sql

ALTER TABLE research_fund_directory ADD COLUMN fund_size_currency TEXT;
ALTER TABLE research_fund_directory ADD COLUMN record_kind TEXT;
ALTER TABLE research_fund_directory_reports ADD COLUMN fund_size_currency TEXT;

CREATE TABLE IF NOT EXISTS research_fund_list_defaults (
  source_name   TEXT PRIMARY KEY,
  record_kind   TEXT,
  size_currency TEXT,
  basis         TEXT NOT NULL,
  set_on        TEXT NOT NULL
);

-- ── The allowed values ───────────────────────────────────────────────────────

CREATE TRIGGER IF NOT EXISTS research_fund_list_defaults_values_insert
BEFORE INSERT ON research_fund_list_defaults
WHEN (NEW.record_kind IS NOT NULL AND NEW.record_kind NOT IN ('vehicle', 'manager', 'accelerator', 'resource'))
  OR (NEW.size_currency IS NOT NULL AND NOT (length(NEW.size_currency) = 3 AND NEW.size_currency GLOB '[A-Z][A-Z][A-Z]'))
BEGIN
  SELECT RAISE(ABORT, 'research_fund_list_defaults: record_kind must be vehicle, manager, accelerator or resource, and size_currency three capital letters');
END;

CREATE TRIGGER IF NOT EXISTS research_fund_list_defaults_values_update
BEFORE UPDATE OF record_kind, size_currency ON research_fund_list_defaults
WHEN (NEW.record_kind IS NOT NULL AND NEW.record_kind NOT IN ('vehicle', 'manager', 'accelerator', 'resource'))
  OR (NEW.size_currency IS NOT NULL AND NOT (length(NEW.size_currency) = 3 AND NEW.size_currency GLOB '[A-Z][A-Z][A-Z]'))
BEGIN
  SELECT RAISE(ABORT, 'research_fund_list_defaults: record_kind must be vehicle, manager, accelerator or resource, and size_currency three capital letters');
END;

CREATE TRIGGER IF NOT EXISTS research_fund_directory_values_insert
BEFORE INSERT ON research_fund_directory
WHEN (NEW.record_kind IS NOT NULL AND NEW.record_kind NOT IN ('vehicle', 'manager', 'accelerator', 'resource'))
  OR (NEW.fund_size_currency IS NOT NULL AND NOT (length(NEW.fund_size_currency) = 3 AND NEW.fund_size_currency GLOB '[A-Z][A-Z][A-Z]'))
BEGIN
  SELECT RAISE(ABORT, 'research_fund_directory: record_kind must be vehicle, manager, accelerator or resource, and fund_size_currency three capital letters');
END;

CREATE TRIGGER IF NOT EXISTS research_fund_directory_values_update
BEFORE UPDATE OF record_kind, fund_size_currency ON research_fund_directory
WHEN (NEW.record_kind IS NOT NULL AND NEW.record_kind NOT IN ('vehicle', 'manager', 'accelerator', 'resource'))
  OR (NEW.fund_size_currency IS NOT NULL AND NOT (length(NEW.fund_size_currency) = 3 AND NEW.fund_size_currency GLOB '[A-Z][A-Z][A-Z]'))
BEGIN
  SELECT RAISE(ABORT, 'research_fund_directory: record_kind must be vehicle, manager, accelerator or resource, and fund_size_currency three capital letters');
END;

CREATE TRIGGER IF NOT EXISTS research_fund_directory_reports_currency_insert
BEFORE INSERT ON research_fund_directory_reports
WHEN NEW.fund_size_currency IS NOT NULL AND NOT (length(NEW.fund_size_currency) = 3 AND NEW.fund_size_currency GLOB '[A-Z][A-Z][A-Z]')
BEGIN
  SELECT RAISE(ABORT, 'research_fund_directory_reports: fund_size_currency must be three capital letters');
END;

CREATE TRIGGER IF NOT EXISTS research_fund_directory_reports_currency_update
BEFORE UPDATE OF fund_size_currency ON research_fund_directory_reports
WHEN NEW.fund_size_currency IS NOT NULL AND NOT (length(NEW.fund_size_currency) = 3 AND NEW.fund_size_currency GLOB '[A-Z][A-Z][A-Z]')
BEGIN
  SELECT RAISE(ABORT, 'research_fund_directory_reports: fund_size_currency must be three capital letters');
END;

-- ── The lists whose kind and currency are known ──────────────────────────────

INSERT OR IGNORE INTO research_fund_list_defaults (source_name, record_kind, size_currency, basis, set_on) VALUES
  ('EuroTech VC Funds (public spreadsheet)', 'vehicle', 'EUR',
   'D7744: one row per fund vehicle (D7166); sizes in euros (D535).', '2026-11-27'),
  ('Shai Goldman — new VC funds at/below $200M', 'vehicle', 'USD',
   'D7744: one row per new fund vehicle; sizes in US dollars (migration 429, D7166).', '2026-11-27'),
  ('Axal VC curated global fund directory', 'manager', NULL,
   'D7744: #7326 manager records; no vehicle, size or vintage is claimed.', '2026-11-27'),
  ('Axal VC — verified fund manager websites', 'manager', NULL,
   'D7744: PR #7337 (migration 202611181350_7325) manager records; no size is claimed.', '2026-11-27'),
  ('Axal VC verified global fund managers (2026-11-19)', 'manager', NULL,
   'D7744: PR #7586 (migration 202611190015_7585) manager records; no size is claimed.', '2026-11-27');

-- ── Backfill, for every listed list ──────────────────────────────────────────

UPDATE research_fund_directory
   SET record_kind = COALESCE(record_kind,
         (SELECT l.record_kind FROM research_fund_list_defaults l WHERE l.source_name = research_fund_directory.source_name)),
       fund_size_currency = CASE WHEN fund_size_cents IS NOT NULL THEN COALESCE(fund_size_currency,
         (SELECT l.size_currency FROM research_fund_list_defaults l WHERE l.source_name = research_fund_directory.source_name))
         ELSE fund_size_currency END
 WHERE source_name IN (SELECT source_name FROM research_fund_list_defaults);

-- A report row takes its fund's list currency, where the report has a size.
UPDATE research_fund_directory_reports
   SET fund_size_currency = (SELECT l.size_currency FROM research_fund_directory d
                               JOIN research_fund_list_defaults l ON l.source_name = d.source_name
                              WHERE d.uid = research_fund_directory_reports.fund_uid)
 WHERE fund_size_cents IS NOT NULL AND fund_size_currency IS NULL;

-- ── Stamping on insert ───────────────────────────────────────────────────────

CREATE TRIGGER IF NOT EXISTS research_fund_directory_list_defaults_stamp
AFTER INSERT ON research_fund_directory
WHEN (NEW.record_kind IS NULL OR (NEW.fund_size_cents IS NOT NULL AND NEW.fund_size_currency IS NULL))
 AND EXISTS (SELECT 1 FROM research_fund_list_defaults l WHERE l.source_name = NEW.source_name)
BEGIN
  UPDATE research_fund_directory
     SET record_kind = COALESCE(record_kind,
           (SELECT l.record_kind FROM research_fund_list_defaults l WHERE l.source_name = NEW.source_name)),
         fund_size_currency = CASE WHEN fund_size_cents IS NOT NULL THEN COALESCE(fund_size_currency,
           (SELECT l.size_currency FROM research_fund_list_defaults l WHERE l.source_name = NEW.source_name))
           ELSE fund_size_currency END
   WHERE uid = NEW.uid;
END;

CREATE TRIGGER IF NOT EXISTS research_fund_directory_reports_list_defaults_stamp
AFTER INSERT ON research_fund_directory_reports
WHEN NEW.fund_size_cents IS NOT NULL AND NEW.fund_size_currency IS NULL
BEGIN
  UPDATE research_fund_directory_reports
     SET fund_size_currency = (SELECT l.size_currency FROM research_fund_directory d
                                 JOIN research_fund_list_defaults l ON l.source_name = d.source_name
                                WHERE d.uid = NEW.fund_uid)
   WHERE fund_uid = NEW.fund_uid AND period = NEW.period;
END;
