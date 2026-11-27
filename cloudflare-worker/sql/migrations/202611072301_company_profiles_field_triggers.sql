-- D4962 (#4962): the two stable invariants of company_profiles, enforced by the database as well as the route.
--
-- `PATCH /company/:uid` and `POST /company/create` validate every General field (services/companyProfileFields.ts).
-- These triggers back the two that will not change: `stage` is one of the nine values below, and `employee_count` is
-- a whole number from 0 to 1,000,000. They are triggers and not CHECK constraints because SQLite can only add a CHECK
-- by rebuilding the table, and a rebuild would fail the deploy on any legacy row that predates the route's validation.
-- A trigger fires only on a NEW write: an INSERT, or an UPDATE that sets the column. A legacy row that is never
-- written keeps its value, and a legacy row written for another column (a rename, an archive) is not re-checked.
--
-- Not covered here, on purpose: description length and the URL shapes. Those are the route's, and a legacy row that
-- exceeds them must stay readable and renameable.
CREATE TRIGGER IF NOT EXISTS company_profiles_stage_insert
BEFORE INSERT ON company_profiles
WHEN NEW.stage IS NOT NULL AND NEW.stage NOT IN ('idea', 'pre_seed', 'seed', 'series_a', 'series_b', 'series_c_plus', 'growth', 'profitable', 'public')
BEGIN
  SELECT RAISE(ABORT, 'company_profiles.stage: unsupported value');
END;

CREATE TRIGGER IF NOT EXISTS company_profiles_stage_update
BEFORE UPDATE OF stage ON company_profiles
WHEN NEW.stage IS NOT NULL AND NEW.stage NOT IN ('idea', 'pre_seed', 'seed', 'series_a', 'series_b', 'series_c_plus', 'growth', 'profitable', 'public')
BEGIN
  SELECT RAISE(ABORT, 'company_profiles.stage: unsupported value');
END;

CREATE TRIGGER IF NOT EXISTS company_profiles_employee_count_insert
BEFORE INSERT ON company_profiles
WHEN NEW.employee_count IS NOT NULL AND (typeof(NEW.employee_count) != 'integer' OR NEW.employee_count < 0 OR NEW.employee_count > 1000000)
BEGIN
  SELECT RAISE(ABORT, 'company_profiles.employee_count: not a whole number from 0 to 1000000');
END;

CREATE TRIGGER IF NOT EXISTS company_profiles_employee_count_update
BEFORE UPDATE OF employee_count ON company_profiles
WHEN NEW.employee_count IS NOT NULL AND (typeof(NEW.employee_count) != 'integer' OR NEW.employee_count < 0 OR NEW.employee_count > 1000000)
BEGIN
  SELECT RAISE(ABORT, 'company_profiles.employee_count: not a whole number from 0 to 1000000');
END;
