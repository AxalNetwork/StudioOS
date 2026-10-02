-- 367 — declare the four company research tables production already holds.
--
-- They were created on production by hand between 2026-09-30 14:57 and 23:34
-- UTC, with no migration, so every deploy from run 566 onward went red on
-- "repo can still rebuild production's schema": a fresh database built from
-- the repo would come up without them. The owner chose to keep them.
--
-- Each statement is production's own DDL, copied verbatim from the drift
-- check's output in deploy run 574 (`sqlite_master.sql`, schema only), with
-- IF NOT EXISTS added. On production every statement is therefore a no-op; on
-- a fresh database it creates the same table production has.
--
-- No code reads or writes these tables yet. Declaring them is what makes the
-- repo's schema story match production again; it does not wire a feature.

CREATE TABLE IF NOT EXISTS company_employment_history (employment_id INTEGER PRIMARY KEY AUTOINCREMENT, company_id INTEGER NOT NULL, observed_date TEXT, employee_count INTEGER NOT NULL, source TEXT NOT NULL, source_url TEXT NOT NULL, verified_at TEXT, confidence TEXT NOT NULL DEFAULT 'low', UNIQUE(company_id,observed_date,employee_count,source_url));

CREATE TABLE IF NOT EXISTS company_financials (financial_id INTEGER PRIMARY KEY AUTOINCREMENT, company_id INTEGER NOT NULL, period TEXT, period_type TEXT, metric_type TEXT NOT NULL, revenue REAL, revenue_currency TEXT, revenue_growth REAL, arr REAL, mrr REAL, gross_profit REAL, gross_margin REAL, ebitda REAL, ebitda_margin REAL, net_income REAL, cash REAL, debt REAL, burn_rate REAL, runway REAL, employees INTEGER, source_url TEXT NOT NULL, source_name TEXT NOT NULL, verified_at TEXT, confidence TEXT NOT NULL DEFAULT 'low', UNIQUE(company_id,period,metric_type,source_url));

CREATE TABLE IF NOT EXISTS company_funding_rounds (funding_round_id INTEGER PRIMARY KEY AUTOINCREMENT, company_id INTEGER NOT NULL, round_type TEXT, stage TEXT, announcement_date TEXT, closing_date TEXT, amount REAL, currency TEXT, pre_money_valuation REAL, post_money_valuation REAL, valuation_currency TEXT, lead_investor TEXT, investors TEXT, source_url TEXT NOT NULL, source_name TEXT NOT NULL, verified_at TEXT, confidence TEXT NOT NULL DEFAULT 'low', UNIQUE(company_id,announcement_date,amount,source_url));

CREATE TABLE IF NOT EXISTS company_sources (source_id INTEGER PRIMARY KEY AUTOINCREMENT, company_id INTEGER NOT NULL, field_name TEXT NOT NULL, source_name TEXT NOT NULL, source_type TEXT NOT NULL, source_url TEXT NOT NULL, publication_date TEXT, retrieved_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, verified_at TEXT, confidence TEXT NOT NULL DEFAULT 'low', UNIQUE(company_id,field_name,source_url));
