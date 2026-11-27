-- Migration 404: US public companies from SEC EDGAR (#1230, D595).
--
-- WRITTEN BY scripts/import-sec-edgar.mjs. Do not edit by hand: rerun the
-- importer before this file is applied, and never after (an applied
-- migration is never edited).
--
-- Source:  SEC EDGAR, https://www.sec.gov/files/company_tickers_exchange.json
-- Licence: US government work, not subject to copyright in the United States (17 U.S.C. § 105)
-- Read:    2026-10-06
-- 0 listings in the file; 0 companies (one row per CIK);
-- 0 listings skipped by the importer's checks.
--
-- Each row is what EDGAR records: CIK, name, ticker, exchange, and the
-- company's other tickers. Nothing else is recorded here: no country,
-- sector, size or people. A table of its own, so these rows never mix
-- with signal_companies and its bands (D595). INSERT OR IGNORE keyed on
-- CIK: applying it twice leaves the same rows.

CREATE TABLE IF NOT EXISTS research_public_companies (
  cik            TEXT PRIMARY KEY CHECK (length(cik) = 10),
  name           TEXT NOT NULL,
  ticker         TEXT NOT NULL,
  exchange       TEXT,
  other_listings TEXT,
  source_name    TEXT NOT NULL,
  source_url     TEXT NOT NULL,
  licence        TEXT NOT NULL,
  as_of          TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_research_public_companies_name ON research_public_companies (name);
CREATE INDEX IF NOT EXISTS idx_research_public_companies_ticker ON research_public_companies (ticker);
