-- D7744 (#7744): the forward fix for 202611270508_7744_research_fund_size_currency_and_kind.sql.
-- That migration adds three nullable columns, the research_fund_list_defaults table, value-check triggers and
-- stamping triggers. A Worker from before it never names the new columns: its inserts are stamped by the triggers
-- and its reads ignore the columns, so a rolled-back Worker keeps working on the migrated database. Recovery
-- therefore needs no schema change; this fix only puts back the table and the triggers if a hand recovery dropped
-- any of them, so the columns keep being checked and stamped. Idempotent (IF NOT EXISTS), and it deletes no row.

CREATE TABLE IF NOT EXISTS research_fund_list_defaults (
  source_name   TEXT PRIMARY KEY,
  record_kind   TEXT,
  size_currency TEXT,
  basis         TEXT NOT NULL,
  set_on        TEXT NOT NULL
);

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
