-- D7928-p2 (#7928): the bls-ce source's text, corrected after the BLS terms and the real calendar-year tables were read
-- on 2026-11-27. The 202611270444 migration registered the source before bls.gov could be reached, so its usage note
-- said the terms were unread and its CV definitions named a `CV(%)` row the tables do not have (BLS labels it `RSE`).
-- Text only: the source stays DISABLED (enabling it is the owner's call) and export_allowed stays unset (D7716). No
-- observation, metric key, unit or column changes.
-- forward-fix: cloudflare-worker/sql/forward-fixes/202611271256_7928_bls_ce_verified_terms.fix.sql
UPDATE research_market_sources SET
 dataset_or_edition = 'Consumer Expenditure Surveys, calendar-year Table 1721 (type of area): annual expenditure means, shares, standard errors and relative standard errors, All consumer units column, calendar years 2023 to 2025',
 license_or_usage_note = 'Source: U.S. Bureau of Labor Statistics, Consumer Expenditure Surveys, calendar-year Table 1721 (type of area), retrieved on each row''s retrieval date. BLS states that everything it publishes is in the public domain, except previously copyrighted photographs and illustrations, and asks to be cited as the source (bls.gov/bls/linksite.htm, read 2026-11-27); its robot policy blocks excessive automated retrieval and robots without owner contact information (bls.gov/bls/pss.htm), so each download sends an identifying User-Agent and one batch reads one file. Values are not modified. Not endorsed by BLS. Limitations: means per consumer unit, not per household or per person; sample estimates with sampling error, whose published standard error and relative standard error (coefficient of variation) are stored beside each mean; cells BLS does not publish (suppressed, or too small to display) store no row; an estimate BLS flags for caution (relative standard error of 25 percent or more, 2024 tables on) is stored with that flag in its limitations.'
WHERE id = 'bls-ce';

UPDATE research_market_metrics
SET definition = replace(definition, '(CV(%) row)', '(RSE row: BLS''s relative standard error)')
WHERE source_id = 'bls-ce';
