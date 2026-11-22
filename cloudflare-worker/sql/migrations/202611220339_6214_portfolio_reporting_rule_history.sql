-- D6214: complete, attributed rule revisions; legacy rules are the initial history.
CREATE TABLE IF NOT EXISTS portfolio_reporting_rule_sets (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 fund_id INTEGER REFERENCES vc_funds(id),
 rules_json TEXT NOT NULL,
 due_days INTEGER NOT NULL DEFAULT 30 CHECK(typeof(due_days)='integer' AND due_days BETWEEN 0 AND 365),
 effective_month TEXT NOT NULL,
 effective_quarter TEXT NOT NULL,
 updated_by INTEGER REFERENCES users(id),
 updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_portfolio_rule_history ON portfolio_reporting_rule_sets(fund_id,id);
INSERT INTO portfolio_reporting_rule_sets(fund_id,rules_json,effective_month,effective_quarter)
 SELECT d.fund_id,json_group_array(json_object('kpi_key',d.kpi_key,'name',d.name,'definition',d.definition,
 'unit',d.unit,'cadence',d.cadence,'required',d.required,'applies_to',d.applies_to,'sort_order',d.sort_order)), '0001-01','0001-Q1'
 FROM (SELECT * FROM portfolio_kpi_definitions ORDER BY sort_order,id) d
 WHERE NOT EXISTS (SELECT 1 FROM portfolio_reporting_rule_sets h WHERE h.fund_id IS d.fund_id)
 GROUP BY d.fund_id;

INSERT INTO portfolio_reporting_rule_sets(fund_id,rules_json,effective_month,effective_quarter)
 SELECT NULL,'[]','0001-01','0001-Q1' WHERE NOT EXISTS(SELECT 1 FROM portfolio_reporting_rule_sets WHERE fund_id IS NULL);
