-- D7929 (#7929): the SEC EDGAR company financial facts source and its six catalogue metrics. Data only: one source row
-- and six catalogue rows. No observation is seeded; rows arrive only through the operator import (D7709). The source
-- lands DISABLED: #7929 authorises no live activation, and the SEC's pages could not be read from the session that
-- wrote this (D7929), so its terms and fair-access rules must be read before an owner enables it. export_allowed stays
-- unset (D7716: export is a per-source owner decision). Every metric is one registrant's own reported figure: never a
-- market size, a market share or an industry total.
-- forward-fix: cloudflare-worker/sql/forward-fixes/202611281123_7929_sec_edgar_facts_source.fix.sql
INSERT OR IGNORE INTO research_market_sources
(id, name, source_url, dataset_or_edition, methodology_url, license_or_usage_note, refresh_policy, enabled)
VALUES
('sec-edgar-facts', 'U.S. Securities and Exchange Commission EDGAR company financial facts (XBRL)',
 'https://www.sec.gov/search-filings/edgar-application-programming-interfaces',
 'EDGAR XBRL company-concept API (data.sec.gov/api/xbrl/companyconcept), one registrant and up to four concepts per batch, annual periods reported in 10-K, 20-F and 40-F filings and their amendments',
 'https://www.sec.gov/search-filings/edgar-application-programming-interfaces',
 'Source: U.S. Securities and Exchange Commission, EDGAR, XBRL financial data as filed by each registrant, retrieved on each row''s retrieval date. Each row is one company''s own reported figure for its own reporting scope (the registrant as it reports, without segment or geographic breakdown), as filed in the accession it names; it is not a market size, a market share or an industry total. Not endorsed by the SEC. The SEC''s terms and fair-access rules (a declared User-Agent naming the requester and a contact address; at most 10 requests per second) were not read from sec.gov when this source was registered (D7929) and must be confirmed before it is enabled.',
 'annual', 0);

INSERT OR IGNORE INTO research_market_metrics (metric_key, source_id, label, definition, unit) VALUES
('edgar_revenues', 'sec-edgar-facts', 'Company-reported revenues (us-gaap:Revenues)', 'One registrant''s revenues for one annual reporting period as it tagged them us-gaap:Revenues in a 10-K, 20-F or 40-F filing, in the currency it reported. A company''s own revenue: never a market size, a market share or an industry total.', 'reported currency'),
('edgar_revenue_from_contracts', 'sec-edgar-facts', 'Company-reported revenue from contracts with customers (us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax)', 'One registrant''s revenue from contracts with customers, excluding assessed tax, for one annual reporting period, as tagged in its annual filing, in the currency it reported. A company''s own revenue: never a market size, a market share or an industry total.', 'reported currency'),
('edgar_operating_income', 'sec-edgar-facts', 'Company-reported operating income or loss (us-gaap:OperatingIncomeLoss)', 'One registrant''s operating income (negative for a loss) for one annual reporting period, as tagged in its annual filing, in the currency it reported. Not a market or industry figure.', 'reported currency'),
('edgar_net_income', 'sec-edgar-facts', 'Company-reported net income or loss (us-gaap:NetIncomeLoss)', 'One registrant''s net income or loss for one annual reporting period, as tagged us-gaap:NetIncomeLoss in its annual filing, in the currency it reported. Not a market or industry figure.', 'reported currency'),
('edgar_assets', 'sec-edgar-facts', 'Company-reported total assets (us-gaap:Assets)', 'One registrant''s total assets at the end of one annual reporting period (a balance at an instant, not a flow), as tagged in its annual filing, in the currency it reported. Not a market or industry figure.', 'reported currency'),
('edgar_ifrs_revenue', 'sec-edgar-facts', 'Company-reported revenue (ifrs-full:Revenue)', 'One registrant''s revenue for one annual reporting period as an IFRS filer tagged it ifrs-full:Revenue in a 20-F or 40-F filing, in the currency it reported. A company''s own revenue: never a market size, a market share or an industry total.', 'reported currency');
