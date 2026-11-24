-- D7717 (#7717): the Eurostat structural business statistics source and its three metrics. Data only: one source row
-- and three catalogue rows. No observation is seeded; rows arrive only through the operator import (D7709). The
-- generic `eurostat` row from #7318 is left as it is (disabled). export_allowed stays unset (D7716: not exportable).
-- Enabled because the Eurostat copyright notice (https://ec.europa.eu/eurostat/en/help/copyright-notice, read
-- 2026-11-23) authorises commercial and non-commercial reuse of Eurostat data with the source acknowledged, for the
-- EU, EFTA and candidate countries the importer is limited to (D7717).
INSERT OR IGNORE INTO research_market_sources
(id, name, source_url, dataset_or_edition, methodology_url, license_or_usage_note, refresh_policy, enabled)
VALUES
('eurostat-sbs', 'Eurostat structural business statistics',
 'https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/sbs_sc_ovw',
 'sbs_sc_ovw: Enterprise statistics by size class and NACE Rev. 2 activity (from 2021 onwards), DOI 10.2908/SBS_SC_OVW',
 'https://ec.europa.eu/eurostat/cache/metadata/en/sbs_esms.htm',
 'Source: Eurostat, Enterprise statistics by size class and NACE Rev. 2 activity (from 2021 onwards), https://doi.org/10.2908/SBS_SC_OVW, accessed on the retrieval date of each row. Reused under the Eurostat copyright notice (https://ec.europa.eu/eurostat/en/help/copyright-notice, read 2026-11-23): reuse is authorised provided the source is acknowledged; data for countries outside the EU, EFTA and the candidate countries is not reused commercially and is not imported. Country codes are converted (EL to GRC); values are not modified. Eurostat bears no responsibility for this reuse. Limitations: counts are enterprises, not establishments or every possible buyer; turnover is the revenue of the enterprises in the activity, not what a buyer segment spends on a product; the table covers the business economy and leaves out some activities.',
 'annual', 1);

INSERT OR IGNORE INTO research_market_metrics (metric_key, source_id, label, definition, unit) VALUES
('sbs_enterprises', 'eurostat-sbs', 'Enterprises - number', 'Number of active enterprises in a NACE Rev. 2 activity, size class, country and reference year (Eurostat sbs_sc_ovw, indicator ENT_NR). Counts enterprises, not establishments or every possible buyer.', 'enterprises'),
('sbs_persons_employed', 'eurostat-sbs', 'Persons employed - number', 'Persons employed by the enterprises of a NACE Rev. 2 activity, size class, country and reference year (Eurostat sbs_sc_ovw, indicator EMP_NR).', 'persons'),
('sbs_net_turnover', 'eurostat-sbs', 'Net turnover - million euro', 'Net turnover of the enterprises of a NACE Rev. 2 activity, size class, country and reference year, in million euro at current prices (Eurostat sbs_sc_ovw, indicator NETTUR_MEUR). The revenue of the enterprises in the activity, not what a buyer segment spends on a product.', 'EUR');
