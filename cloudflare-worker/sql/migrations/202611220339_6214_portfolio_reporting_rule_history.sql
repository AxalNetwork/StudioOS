-- D6214: complete, attributed rule revisions; legacy rules are the initial history.
CREATE TABLE IF NOT EXISTS portfolio_reporting_rule_sets (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 fund_id INTEGER REFERENCES vc_funds(id),
 rules_json TEXT NOT NULL CHECK(json_valid(rules_json)),
 due_days INTEGER NOT NULL DEFAULT 30 CHECK(typeof(due_days)='integer' AND due_days BETWEEN 0 AND 365),
 effective_month TEXT NOT NULL,
 effective_quarter TEXT NOT NULL,
 updated_by INTEGER REFERENCES users(id),
 updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_portfolio_rule_history ON portfolio_reporting_rule_sets(fund_id,id);
-- Fail the migration on incompatible legacy rows instead of deploying an unreadable set.
CREATE TRIGGER IF NOT EXISTS portfolio_reporting_rules_validate BEFORE INSERT ON portfolio_reporting_rule_sets
BEGIN
 SELECT CASE WHEN json_type(NEW.rules_json) != 'array' OR json_array_length(NEW.rules_json)>100
 OR EXISTS (SELECT 1 FROM json_each(NEW.rules_json) r WHERE
   json_type(r.value,'$.kpi_key') IS NOT 'text' OR length(json_extract(r.value,'$.kpi_key')) NOT BETWEEN 1 AND 64
   OR json_extract(r.value,'$.kpi_key') GLOB '*[^a-z0-9_]*' OR json_extract(r.value,'$.kpi_key') NOT GLOB '[a-z]*'
   OR json_extract(r.value,'$.kpi_key') IN ('constructor','prototype')
   OR json_type(r.value,'$.name') IS NOT 'text' OR length(trim(json_extract(r.value,'$.name'))) NOT BETWEEN 1 AND 100
   OR json_extract(r.value,'$.cadence') NOT IN ('monthly','quarterly') OR json_type(r.value,'$.cadence') IS NOT 'text'
   OR json_extract(r.value,'$.required') NOT IN (0,1) OR json_type(r.value,'$.required') IS NOT 'integer'
   OR json_type(r.value,'$.applies_to') IS NOT 'text' OR length(trim(json_extract(r.value,'$.applies_to'))) NOT BETWEEN 1 AND 100
   OR json_type(r.value,'$.definition') NOT IN ('text','null') OR length(json_extract(r.value,'$.definition'))>1000
   OR json_type(r.value,'$.unit') NOT IN ('text','null') OR length(json_extract(r.value,'$.unit'))>1000)
 OR EXISTS (SELECT 1 FROM json_each(NEW.rules_json) GROUP BY json_extract(value,'$.cadence'),json_extract(value,'$.kpi_key') HAVING count(*)>1)
 THEN RAISE(ABORT,'Reporting rules need repair before migration or save') END;
END;

INSERT INTO portfolio_reporting_rule_sets(fund_id,rules_json,effective_month,effective_quarter)
 SELECT d.fund_id,json_group_array(json_object('kpi_key',d.kpi_key,'name',d.name,'definition',d.definition,
 'unit',d.unit,'cadence',d.cadence,'required',d.required,'applies_to',d.applies_to,'sort_order',d.sort_order)), '0001-01','0001-Q1'
 FROM (SELECT * FROM portfolio_kpi_definitions ORDER BY sort_order,id) d
 WHERE NOT EXISTS (SELECT 1 FROM portfolio_reporting_rule_sets h WHERE h.fund_id IS d.fund_id)
 GROUP BY d.fund_id;

INSERT INTO portfolio_reporting_rule_sets(fund_id,rules_json,effective_month,effective_quarter)
 SELECT NULL,'[]','0001-01','0001-Q1' WHERE NOT EXISTS(SELECT 1 FROM portfolio_reporting_rule_sets WHERE fund_id IS NULL);
