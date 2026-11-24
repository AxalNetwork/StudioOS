-- import-company-facts v1
-- D7828 (#7828): compiled by scripts/import-company-facts.mjs from the reviewed manifest "fixture-7828".
-- Regenerate and verify with --check; never edit by hand. Writes research_company_facts only.
-- Reviewed 2026-11-20. A fact is written only where its company is served when this file is applied;
-- facts skipped then are this header's 14 facts less the rows with manifest_name 'fixture-7828'.
-- manifest sha256 87f83067fe434fe4d10c9e32b8533ddf934d08ad74ac3da27930446118464f06
-- fact synthetic-7828-brindlemoor bm-product product 9c100ecb8cfdadfa3278dcbf430b37fcc71e98ffc7b1d904a9c561e2c8c269f1
-- fact synthetic-7828-brindlemoor bm-product-index product 3d2232f50590d55357f559db7d82c771e9deaec6f89bcc4afa18357106bfd3a5
-- fact synthetic-7828-brindlemoor bm-use-case use_case 2b39a8142942c8ff70de35f1f1aa22511c8dfdd6da0134fbb3fb288eef73160e
-- fact synthetic-7828-brindlemoor bm-segment-small customer_segment cdd372a74411ae11eda1d887d6b3aec69ea029eeeb60cc465a43b86f00351a00
-- fact synthetic-7828-brindlemoor bm-segment-enterprise customer_segment 9d685757626f3e1c14a7f848614a2960bebe230827cf6b83ef4f68f0e8abffd3
-- fact synthetic-7828-brindlemoor bm-markets markets_served 85e242d706d09f49a1c783b7abaa9b5cdf297ed9d4dbecfe56431432eaeb1032
-- fact synthetic-7828-brindlemoor bm-pricing-1 pricing_model 048e859301428954e71b8ef94c4a672ed05abf705aed1967d9c36238eab2b210
-- fact synthetic-7828-brindlemoor bm-pricing-2 pricing_model 0e574a47b69a76040ab6fb58b1553de1710c268fcf4aae8af99cf1ceae5f2896
-- fact synthetic-7828-brindlemoor bm-delivery delivery_model 0379ec0ec2fb4ef3c97a3091f601d9d2e53db9a81e937c33d4cece3f2d39e506
-- fact synthetic-7828-brindlemoor bm-partners partner_programme 2c1cf984fcbcd94416cc62f057d0e6f78f01b7991bd1a256d22d21d486ed31c5
-- fact synthetic-7828-brindlemoor bm-integrations integration_listing 329e06f7f1200f399d1af588e97eccec326827d5b2c0a28bd47d9ef7095c8086
-- fact synthetic-7828-brindlemoor bm-contact contact_path 84a1dab9bfae854fd0cb01d7ea0a25efc37db5fb159e5c84b367691ee359d772
-- fact synthetic-7828-absent ab-product product 06e63e97073977459bd1acfae3d5b41ee35c741f38a79b369fdf261ce04f0456
-- fact synthetic-7828-withdrawn wd-product product 720eb891513efcf239639248763b8ec6c100ea6f1298d83ae585aa8b346a79e0

-- synthetic-7828-brindlemoor bm-product
INSERT INTO research_company_facts
  (company_uid, fact_key, attribute, value, statement_type, source_url, publisher, passage, source_field,
   market_country, published_at, retrieved_at, reviewed_at, reviewed_by, state, conflicts_with_key, replaces_key, manifest_name)
SELECT 'synthetic-7828-brindlemoor', 'bm-product', 'product', 'Route planning software for regional couriers', 'company_statement', 'https://brindlemoor.example/product', 'Brindlemoor website', 'Brindlemoor plans delivery routes for regional courier fleets.', NULL,
  NULL, '2026-09-01', '2026-11-02', '2026-11-20', 'Synthetic reviewer', 'found', NULL, NULL, 'fixture-7828'
 WHERE EXISTS (SELECT 1 FROM (SELECT d.id,d.uid,d.name,d.website,d.country,d.founded_year,d.sector,
 d.source_name,d.source_url,d.source_license,d.as_of,d.created_at,d.updated_at,
 d.sic_codes,d.competitor_status,d.diligence_status,d.employee_as_of,d.employee_count,
 d.employee_growth_pct,d.funding_currency,d.funding_total,d.last_funding_amount,
 d.last_funding_currency,d.last_funding_date,d.last_funding_type,d.market_share_as_of,
 d.market_share_pct,d.metrics_confidence,d.metrics_evidence_json,d.metrics_source_name,
 d.metrics_source_url,d.metrics_updated_at,d.revenue,d.revenue_as_of,d.revenue_currency,
 d.valuation,d.valuation_as_of,d.valuation_currency,d.website_verified_at,CASE r.reason_code
 WHEN 'verified' THEN 'The recorded evidence has been checked.'
 WHEN 'quality_hold' THEN 'This record is held while its quality is checked.'
 WHEN 'identity_uncertain' THEN 'This company’s identity needs confirmation.'
 WHEN 'source_unavailable' THEN 'The source could not be checked.'
 WHEN 'out_of_scope' THEN 'This record is outside the directory’s scope.'
 WHEN 'source_withdrawn' THEN 'The source has been withdrawn.'
 ELSE 'No review recorded' END AS reason,
 CASE WHEN r.status IS NULL THEN 'No review recorded' ELSE r.status END AS review_label,
 COALESCE(r.status,'not_recorded') AS review_status,r.reason_code,r.next_review_on,r.withdrawn_on
 FROM research_company_directory d LEFT JOIN research_company_reviews r ON r.uid=d.uid
 WHERE NOT EXISTS (SELECT 1 FROM research_company_reviews blocked
   WHERE blocked.uid=d.uid AND blocked.status IN ('excluded','withdrawn'))) AS c WHERE c.uid = 'synthetic-7828-brindlemoor')
ON CONFLICT (company_uid, fact_key) DO NOTHING;

-- synthetic-7828-brindlemoor bm-product-index
INSERT INTO research_company_facts
  (company_uid, fact_key, attribute, value, statement_type, source_url, publisher, passage, source_field,
   market_country, published_at, retrieved_at, reviewed_at, reviewed_by, state, conflicts_with_key, replaces_key, manifest_name)
SELECT 'synthetic-7828-brindlemoor', 'bm-product-index', 'product', 'Courier dispatch software', 'third_party_observation', 'https://www.wikidata.org/wiki/Q999999990', 'Wikidata', NULL, 'P1056 product or material produced',
  NULL, NULL, '2026-11-03', '2026-11-20', 'Synthetic reviewer', 'found', NULL, NULL, 'fixture-7828'
 WHERE EXISTS (SELECT 1 FROM (SELECT d.id,d.uid,d.name,d.website,d.country,d.founded_year,d.sector,
 d.source_name,d.source_url,d.source_license,d.as_of,d.created_at,d.updated_at,
 d.sic_codes,d.competitor_status,d.diligence_status,d.employee_as_of,d.employee_count,
 d.employee_growth_pct,d.funding_currency,d.funding_total,d.last_funding_amount,
 d.last_funding_currency,d.last_funding_date,d.last_funding_type,d.market_share_as_of,
 d.market_share_pct,d.metrics_confidence,d.metrics_evidence_json,d.metrics_source_name,
 d.metrics_source_url,d.metrics_updated_at,d.revenue,d.revenue_as_of,d.revenue_currency,
 d.valuation,d.valuation_as_of,d.valuation_currency,d.website_verified_at,CASE r.reason_code
 WHEN 'verified' THEN 'The recorded evidence has been checked.'
 WHEN 'quality_hold' THEN 'This record is held while its quality is checked.'
 WHEN 'identity_uncertain' THEN 'This company’s identity needs confirmation.'
 WHEN 'source_unavailable' THEN 'The source could not be checked.'
 WHEN 'out_of_scope' THEN 'This record is outside the directory’s scope.'
 WHEN 'source_withdrawn' THEN 'The source has been withdrawn.'
 ELSE 'No review recorded' END AS reason,
 CASE WHEN r.status IS NULL THEN 'No review recorded' ELSE r.status END AS review_label,
 COALESCE(r.status,'not_recorded') AS review_status,r.reason_code,r.next_review_on,r.withdrawn_on
 FROM research_company_directory d LEFT JOIN research_company_reviews r ON r.uid=d.uid
 WHERE NOT EXISTS (SELECT 1 FROM research_company_reviews blocked
   WHERE blocked.uid=d.uid AND blocked.status IN ('excluded','withdrawn'))) AS c WHERE c.uid = 'synthetic-7828-brindlemoor')
ON CONFLICT (company_uid, fact_key) DO NOTHING;

-- synthetic-7828-brindlemoor bm-use-case
INSERT INTO research_company_facts
  (company_uid, fact_key, attribute, value, statement_type, source_url, publisher, passage, source_field,
   market_country, published_at, retrieved_at, reviewed_at, reviewed_by, state, conflicts_with_key, replaces_key, manifest_name)
SELECT 'synthetic-7828-brindlemoor', 'bm-use-case', 'use_case', 'Same-day parcel routing', 'company_statement', 'https://brindlemoor.example/customers', 'Brindlemoor website', 'Couriers use Brindlemoor to route same-day parcels.', NULL,
  NULL, NULL, '2026-11-02', '2026-11-20', 'Synthetic reviewer', 'found', NULL, NULL, 'fixture-7828'
 WHERE EXISTS (SELECT 1 FROM (SELECT d.id,d.uid,d.name,d.website,d.country,d.founded_year,d.sector,
 d.source_name,d.source_url,d.source_license,d.as_of,d.created_at,d.updated_at,
 d.sic_codes,d.competitor_status,d.diligence_status,d.employee_as_of,d.employee_count,
 d.employee_growth_pct,d.funding_currency,d.funding_total,d.last_funding_amount,
 d.last_funding_currency,d.last_funding_date,d.last_funding_type,d.market_share_as_of,
 d.market_share_pct,d.metrics_confidence,d.metrics_evidence_json,d.metrics_source_name,
 d.metrics_source_url,d.metrics_updated_at,d.revenue,d.revenue_as_of,d.revenue_currency,
 d.valuation,d.valuation_as_of,d.valuation_currency,d.website_verified_at,CASE r.reason_code
 WHEN 'verified' THEN 'The recorded evidence has been checked.'
 WHEN 'quality_hold' THEN 'This record is held while its quality is checked.'
 WHEN 'identity_uncertain' THEN 'This company’s identity needs confirmation.'
 WHEN 'source_unavailable' THEN 'The source could not be checked.'
 WHEN 'out_of_scope' THEN 'This record is outside the directory’s scope.'
 WHEN 'source_withdrawn' THEN 'The source has been withdrawn.'
 ELSE 'No review recorded' END AS reason,
 CASE WHEN r.status IS NULL THEN 'No review recorded' ELSE r.status END AS review_label,
 COALESCE(r.status,'not_recorded') AS review_status,r.reason_code,r.next_review_on,r.withdrawn_on
 FROM research_company_directory d LEFT JOIN research_company_reviews r ON r.uid=d.uid
 WHERE NOT EXISTS (SELECT 1 FROM research_company_reviews blocked
   WHERE blocked.uid=d.uid AND blocked.status IN ('excluded','withdrawn'))) AS c WHERE c.uid = 'synthetic-7828-brindlemoor')
ON CONFLICT (company_uid, fact_key) DO NOTHING;

-- synthetic-7828-brindlemoor bm-segment-small
INSERT INTO research_company_facts
  (company_uid, fact_key, attribute, value, statement_type, source_url, publisher, passage, source_field,
   market_country, published_at, retrieved_at, reviewed_at, reviewed_by, state, conflicts_with_key, replaces_key, manifest_name)
SELECT 'synthetic-7828-brindlemoor', 'bm-segment-small', 'customer_segment', 'Small regional couriers', 'company_statement', 'https://brindlemoor.example/about', 'Brindlemoor website', 'Built for small regional couriers.', NULL,
  NULL, NULL, '2026-11-02', '2026-11-20', 'Synthetic reviewer', 'found', NULL, NULL, 'fixture-7828'
 WHERE EXISTS (SELECT 1 FROM (SELECT d.id,d.uid,d.name,d.website,d.country,d.founded_year,d.sector,
 d.source_name,d.source_url,d.source_license,d.as_of,d.created_at,d.updated_at,
 d.sic_codes,d.competitor_status,d.diligence_status,d.employee_as_of,d.employee_count,
 d.employee_growth_pct,d.funding_currency,d.funding_total,d.last_funding_amount,
 d.last_funding_currency,d.last_funding_date,d.last_funding_type,d.market_share_as_of,
 d.market_share_pct,d.metrics_confidence,d.metrics_evidence_json,d.metrics_source_name,
 d.metrics_source_url,d.metrics_updated_at,d.revenue,d.revenue_as_of,d.revenue_currency,
 d.valuation,d.valuation_as_of,d.valuation_currency,d.website_verified_at,CASE r.reason_code
 WHEN 'verified' THEN 'The recorded evidence has been checked.'
 WHEN 'quality_hold' THEN 'This record is held while its quality is checked.'
 WHEN 'identity_uncertain' THEN 'This company’s identity needs confirmation.'
 WHEN 'source_unavailable' THEN 'The source could not be checked.'
 WHEN 'out_of_scope' THEN 'This record is outside the directory’s scope.'
 WHEN 'source_withdrawn' THEN 'The source has been withdrawn.'
 ELSE 'No review recorded' END AS reason,
 CASE WHEN r.status IS NULL THEN 'No review recorded' ELSE r.status END AS review_label,
 COALESCE(r.status,'not_recorded') AS review_status,r.reason_code,r.next_review_on,r.withdrawn_on
 FROM research_company_directory d LEFT JOIN research_company_reviews r ON r.uid=d.uid
 WHERE NOT EXISTS (SELECT 1 FROM research_company_reviews blocked
   WHERE blocked.uid=d.uid AND blocked.status IN ('excluded','withdrawn'))) AS c WHERE c.uid = 'synthetic-7828-brindlemoor')
ON CONFLICT (company_uid, fact_key) DO NOTHING;

-- synthetic-7828-brindlemoor bm-segment-enterprise
INSERT INTO research_company_facts
  (company_uid, fact_key, attribute, value, statement_type, source_url, publisher, passage, source_field,
   market_country, published_at, retrieved_at, reviewed_at, reviewed_by, state, conflicts_with_key, replaces_key, manifest_name)
SELECT 'synthetic-7828-brindlemoor', 'bm-segment-enterprise', 'customer_segment', 'Enterprise carriers only', 'third_party_observation', 'https://trade-review.example/brindlemoor', 'Synthetic Trade Review', 'Brindlemoor sells only to enterprise carriers.', NULL,
  NULL, '2026-10-15', '2026-11-04', '2026-11-20', 'Synthetic reviewer', 'found', 'bm-segment-small', NULL, 'fixture-7828'
 WHERE EXISTS (SELECT 1 FROM (SELECT d.id,d.uid,d.name,d.website,d.country,d.founded_year,d.sector,
 d.source_name,d.source_url,d.source_license,d.as_of,d.created_at,d.updated_at,
 d.sic_codes,d.competitor_status,d.diligence_status,d.employee_as_of,d.employee_count,
 d.employee_growth_pct,d.funding_currency,d.funding_total,d.last_funding_amount,
 d.last_funding_currency,d.last_funding_date,d.last_funding_type,d.market_share_as_of,
 d.market_share_pct,d.metrics_confidence,d.metrics_evidence_json,d.metrics_source_name,
 d.metrics_source_url,d.metrics_updated_at,d.revenue,d.revenue_as_of,d.revenue_currency,
 d.valuation,d.valuation_as_of,d.valuation_currency,d.website_verified_at,CASE r.reason_code
 WHEN 'verified' THEN 'The recorded evidence has been checked.'
 WHEN 'quality_hold' THEN 'This record is held while its quality is checked.'
 WHEN 'identity_uncertain' THEN 'This company’s identity needs confirmation.'
 WHEN 'source_unavailable' THEN 'The source could not be checked.'
 WHEN 'out_of_scope' THEN 'This record is outside the directory’s scope.'
 WHEN 'source_withdrawn' THEN 'The source has been withdrawn.'
 ELSE 'No review recorded' END AS reason,
 CASE WHEN r.status IS NULL THEN 'No review recorded' ELSE r.status END AS review_label,
 COALESCE(r.status,'not_recorded') AS review_status,r.reason_code,r.next_review_on,r.withdrawn_on
 FROM research_company_directory d LEFT JOIN research_company_reviews r ON r.uid=d.uid
 WHERE NOT EXISTS (SELECT 1 FROM research_company_reviews blocked
   WHERE blocked.uid=d.uid AND blocked.status IN ('excluded','withdrawn'))) AS c WHERE c.uid = 'synthetic-7828-brindlemoor')
ON CONFLICT (company_uid, fact_key) DO NOTHING;

-- synthetic-7828-brindlemoor bm-markets
INSERT INTO research_company_facts
  (company_uid, fact_key, attribute, value, statement_type, source_url, publisher, passage, source_field,
   market_country, published_at, retrieved_at, reviewed_at, reviewed_by, state, conflicts_with_key, replaces_key, manifest_name)
SELECT 'synthetic-7828-brindlemoor', 'bm-markets', 'markets_served', 'Portugal', 'company_statement', 'https://brindlemoor.example/about', 'Brindlemoor website', 'We serve couriers across Portugal.', NULL,
  'PT', NULL, '2026-11-02', '2026-11-20', 'Synthetic reviewer', 'found', NULL, NULL, 'fixture-7828'
 WHERE EXISTS (SELECT 1 FROM (SELECT d.id,d.uid,d.name,d.website,d.country,d.founded_year,d.sector,
 d.source_name,d.source_url,d.source_license,d.as_of,d.created_at,d.updated_at,
 d.sic_codes,d.competitor_status,d.diligence_status,d.employee_as_of,d.employee_count,
 d.employee_growth_pct,d.funding_currency,d.funding_total,d.last_funding_amount,
 d.last_funding_currency,d.last_funding_date,d.last_funding_type,d.market_share_as_of,
 d.market_share_pct,d.metrics_confidence,d.metrics_evidence_json,d.metrics_source_name,
 d.metrics_source_url,d.metrics_updated_at,d.revenue,d.revenue_as_of,d.revenue_currency,
 d.valuation,d.valuation_as_of,d.valuation_currency,d.website_verified_at,CASE r.reason_code
 WHEN 'verified' THEN 'The recorded evidence has been checked.'
 WHEN 'quality_hold' THEN 'This record is held while its quality is checked.'
 WHEN 'identity_uncertain' THEN 'This company’s identity needs confirmation.'
 WHEN 'source_unavailable' THEN 'The source could not be checked.'
 WHEN 'out_of_scope' THEN 'This record is outside the directory’s scope.'
 WHEN 'source_withdrawn' THEN 'The source has been withdrawn.'
 ELSE 'No review recorded' END AS reason,
 CASE WHEN r.status IS NULL THEN 'No review recorded' ELSE r.status END AS review_label,
 COALESCE(r.status,'not_recorded') AS review_status,r.reason_code,r.next_review_on,r.withdrawn_on
 FROM research_company_directory d LEFT JOIN research_company_reviews r ON r.uid=d.uid
 WHERE NOT EXISTS (SELECT 1 FROM research_company_reviews blocked
   WHERE blocked.uid=d.uid AND blocked.status IN ('excluded','withdrawn'))) AS c WHERE c.uid = 'synthetic-7828-brindlemoor')
ON CONFLICT (company_uid, fact_key) DO NOTHING;

-- synthetic-7828-brindlemoor bm-pricing-1
INSERT INTO research_company_facts
  (company_uid, fact_key, attribute, value, statement_type, source_url, publisher, passage, source_field,
   market_country, published_at, retrieved_at, reviewed_at, reviewed_by, state, conflicts_with_key, replaces_key, manifest_name)
SELECT 'synthetic-7828-brindlemoor', 'bm-pricing-1', 'pricing_model', 'Per-seat subscription', 'company_statement', 'https://brindlemoor.example/pricing', 'Brindlemoor website', 'Plans are billed per seat.', NULL,
  NULL, NULL, '2026-06-01', '2026-11-20', 'Synthetic reviewer', 'found', NULL, NULL, 'fixture-7828'
 WHERE EXISTS (SELECT 1 FROM (SELECT d.id,d.uid,d.name,d.website,d.country,d.founded_year,d.sector,
 d.source_name,d.source_url,d.source_license,d.as_of,d.created_at,d.updated_at,
 d.sic_codes,d.competitor_status,d.diligence_status,d.employee_as_of,d.employee_count,
 d.employee_growth_pct,d.funding_currency,d.funding_total,d.last_funding_amount,
 d.last_funding_currency,d.last_funding_date,d.last_funding_type,d.market_share_as_of,
 d.market_share_pct,d.metrics_confidence,d.metrics_evidence_json,d.metrics_source_name,
 d.metrics_source_url,d.metrics_updated_at,d.revenue,d.revenue_as_of,d.revenue_currency,
 d.valuation,d.valuation_as_of,d.valuation_currency,d.website_verified_at,CASE r.reason_code
 WHEN 'verified' THEN 'The recorded evidence has been checked.'
 WHEN 'quality_hold' THEN 'This record is held while its quality is checked.'
 WHEN 'identity_uncertain' THEN 'This company’s identity needs confirmation.'
 WHEN 'source_unavailable' THEN 'The source could not be checked.'
 WHEN 'out_of_scope' THEN 'This record is outside the directory’s scope.'
 WHEN 'source_withdrawn' THEN 'The source has been withdrawn.'
 ELSE 'No review recorded' END AS reason,
 CASE WHEN r.status IS NULL THEN 'No review recorded' ELSE r.status END AS review_label,
 COALESCE(r.status,'not_recorded') AS review_status,r.reason_code,r.next_review_on,r.withdrawn_on
 FROM research_company_directory d LEFT JOIN research_company_reviews r ON r.uid=d.uid
 WHERE NOT EXISTS (SELECT 1 FROM research_company_reviews blocked
   WHERE blocked.uid=d.uid AND blocked.status IN ('excluded','withdrawn'))) AS c WHERE c.uid = 'synthetic-7828-brindlemoor')
ON CONFLICT (company_uid, fact_key) DO NOTHING;

-- synthetic-7828-brindlemoor bm-pricing-2
INSERT INTO research_company_facts
  (company_uid, fact_key, attribute, value, statement_type, source_url, publisher, passage, source_field,
   market_country, published_at, retrieved_at, reviewed_at, reviewed_by, state, conflicts_with_key, replaces_key, manifest_name)
SELECT 'synthetic-7828-brindlemoor', 'bm-pricing-2', 'pricing_model', 'Usage-based subscription', 'company_statement', 'https://brindlemoor.example/pricing', 'Brindlemoor website', 'Plans are billed by the number of routes planned.', NULL,
  NULL, NULL, '2026-11-02', '2026-11-20', 'Synthetic reviewer', 'found', NULL, 'bm-pricing-1', 'fixture-7828'
 WHERE EXISTS (SELECT 1 FROM (SELECT d.id,d.uid,d.name,d.website,d.country,d.founded_year,d.sector,
 d.source_name,d.source_url,d.source_license,d.as_of,d.created_at,d.updated_at,
 d.sic_codes,d.competitor_status,d.diligence_status,d.employee_as_of,d.employee_count,
 d.employee_growth_pct,d.funding_currency,d.funding_total,d.last_funding_amount,
 d.last_funding_currency,d.last_funding_date,d.last_funding_type,d.market_share_as_of,
 d.market_share_pct,d.metrics_confidence,d.metrics_evidence_json,d.metrics_source_name,
 d.metrics_source_url,d.metrics_updated_at,d.revenue,d.revenue_as_of,d.revenue_currency,
 d.valuation,d.valuation_as_of,d.valuation_currency,d.website_verified_at,CASE r.reason_code
 WHEN 'verified' THEN 'The recorded evidence has been checked.'
 WHEN 'quality_hold' THEN 'This record is held while its quality is checked.'
 WHEN 'identity_uncertain' THEN 'This company’s identity needs confirmation.'
 WHEN 'source_unavailable' THEN 'The source could not be checked.'
 WHEN 'out_of_scope' THEN 'This record is outside the directory’s scope.'
 WHEN 'source_withdrawn' THEN 'The source has been withdrawn.'
 ELSE 'No review recorded' END AS reason,
 CASE WHEN r.status IS NULL THEN 'No review recorded' ELSE r.status END AS review_label,
 COALESCE(r.status,'not_recorded') AS review_status,r.reason_code,r.next_review_on,r.withdrawn_on
 FROM research_company_directory d LEFT JOIN research_company_reviews r ON r.uid=d.uid
 WHERE NOT EXISTS (SELECT 1 FROM research_company_reviews blocked
   WHERE blocked.uid=d.uid AND blocked.status IN ('excluded','withdrawn'))) AS c WHERE c.uid = 'synthetic-7828-brindlemoor')
ON CONFLICT (company_uid, fact_key) DO NOTHING;
UPDATE research_company_facts SET state = 'outdated', replaced_by_key = 'bm-pricing-2'
 WHERE company_uid = 'synthetic-7828-brindlemoor' AND fact_key = 'bm-pricing-1' AND replaced_by_key IS NULL
   AND EXISTS (SELECT 1 FROM research_company_facts n WHERE n.company_uid = 'synthetic-7828-brindlemoor' AND n.fact_key = 'bm-pricing-2');

-- synthetic-7828-brindlemoor bm-delivery
INSERT INTO research_company_facts
  (company_uid, fact_key, attribute, value, statement_type, source_url, publisher, passage, source_field,
   market_country, published_at, retrieved_at, reviewed_at, reviewed_by, state, conflicts_with_key, replaces_key, manifest_name)
SELECT 'synthetic-7828-brindlemoor', 'bm-delivery', 'delivery_model', 'On-premises installation', 'third_party_observation', 'https://trade-review.example/brindlemoor-2024', 'Synthetic Trade Review', 'Brindlemoor is installed on the courier''s own servers.', NULL,
  NULL, '2024-03-01', '2026-11-04', '2026-11-20', 'Synthetic reviewer', 'outdated', NULL, NULL, 'fixture-7828'
 WHERE EXISTS (SELECT 1 FROM (SELECT d.id,d.uid,d.name,d.website,d.country,d.founded_year,d.sector,
 d.source_name,d.source_url,d.source_license,d.as_of,d.created_at,d.updated_at,
 d.sic_codes,d.competitor_status,d.diligence_status,d.employee_as_of,d.employee_count,
 d.employee_growth_pct,d.funding_currency,d.funding_total,d.last_funding_amount,
 d.last_funding_currency,d.last_funding_date,d.last_funding_type,d.market_share_as_of,
 d.market_share_pct,d.metrics_confidence,d.metrics_evidence_json,d.metrics_source_name,
 d.metrics_source_url,d.metrics_updated_at,d.revenue,d.revenue_as_of,d.revenue_currency,
 d.valuation,d.valuation_as_of,d.valuation_currency,d.website_verified_at,CASE r.reason_code
 WHEN 'verified' THEN 'The recorded evidence has been checked.'
 WHEN 'quality_hold' THEN 'This record is held while its quality is checked.'
 WHEN 'identity_uncertain' THEN 'This company’s identity needs confirmation.'
 WHEN 'source_unavailable' THEN 'The source could not be checked.'
 WHEN 'out_of_scope' THEN 'This record is outside the directory’s scope.'
 WHEN 'source_withdrawn' THEN 'The source has been withdrawn.'
 ELSE 'No review recorded' END AS reason,
 CASE WHEN r.status IS NULL THEN 'No review recorded' ELSE r.status END AS review_label,
 COALESCE(r.status,'not_recorded') AS review_status,r.reason_code,r.next_review_on,r.withdrawn_on
 FROM research_company_directory d LEFT JOIN research_company_reviews r ON r.uid=d.uid
 WHERE NOT EXISTS (SELECT 1 FROM research_company_reviews blocked
   WHERE blocked.uid=d.uid AND blocked.status IN ('excluded','withdrawn'))) AS c WHERE c.uid = 'synthetic-7828-brindlemoor')
ON CONFLICT (company_uid, fact_key) DO NOTHING;

-- synthetic-7828-brindlemoor bm-partners
INSERT INTO research_company_facts
  (company_uid, fact_key, attribute, value, statement_type, source_url, publisher, passage, source_field,
   market_country, published_at, retrieved_at, reviewed_at, reviewed_by, state, conflicts_with_key, replaces_key, manifest_name)
SELECT 'synthetic-7828-brindlemoor', 'bm-partners', 'partner_programme', NULL, 'company_statement', 'https://brindlemoor.example/partners', 'Brindlemoor website', NULL, NULL,
  NULL, NULL, '2026-11-02', '2026-11-20', 'Synthetic reviewer', 'not_found', NULL, NULL, 'fixture-7828'
 WHERE EXISTS (SELECT 1 FROM (SELECT d.id,d.uid,d.name,d.website,d.country,d.founded_year,d.sector,
 d.source_name,d.source_url,d.source_license,d.as_of,d.created_at,d.updated_at,
 d.sic_codes,d.competitor_status,d.diligence_status,d.employee_as_of,d.employee_count,
 d.employee_growth_pct,d.funding_currency,d.funding_total,d.last_funding_amount,
 d.last_funding_currency,d.last_funding_date,d.last_funding_type,d.market_share_as_of,
 d.market_share_pct,d.metrics_confidence,d.metrics_evidence_json,d.metrics_source_name,
 d.metrics_source_url,d.metrics_updated_at,d.revenue,d.revenue_as_of,d.revenue_currency,
 d.valuation,d.valuation_as_of,d.valuation_currency,d.website_verified_at,CASE r.reason_code
 WHEN 'verified' THEN 'The recorded evidence has been checked.'
 WHEN 'quality_hold' THEN 'This record is held while its quality is checked.'
 WHEN 'identity_uncertain' THEN 'This company’s identity needs confirmation.'
 WHEN 'source_unavailable' THEN 'The source could not be checked.'
 WHEN 'out_of_scope' THEN 'This record is outside the directory’s scope.'
 WHEN 'source_withdrawn' THEN 'The source has been withdrawn.'
 ELSE 'No review recorded' END AS reason,
 CASE WHEN r.status IS NULL THEN 'No review recorded' ELSE r.status END AS review_label,
 COALESCE(r.status,'not_recorded') AS review_status,r.reason_code,r.next_review_on,r.withdrawn_on
 FROM research_company_directory d LEFT JOIN research_company_reviews r ON r.uid=d.uid
 WHERE NOT EXISTS (SELECT 1 FROM research_company_reviews blocked
   WHERE blocked.uid=d.uid AND blocked.status IN ('excluded','withdrawn'))) AS c WHERE c.uid = 'synthetic-7828-brindlemoor')
ON CONFLICT (company_uid, fact_key) DO NOTHING;

-- synthetic-7828-brindlemoor bm-integrations
INSERT INTO research_company_facts
  (company_uid, fact_key, attribute, value, statement_type, source_url, publisher, passage, source_field,
   market_country, published_at, retrieved_at, reviewed_at, reviewed_by, state, conflicts_with_key, replaces_key, manifest_name)
SELECT 'synthetic-7828-brindlemoor', 'bm-integrations', 'integration_listing', NULL, 'company_statement', 'https://brindlemoor.example/faq', 'Brindlemoor website', NULL, NULL,
  NULL, NULL, '2026-11-02', '2026-11-20', 'Synthetic reviewer', 'not_offered', NULL, NULL, 'fixture-7828'
 WHERE EXISTS (SELECT 1 FROM (SELECT d.id,d.uid,d.name,d.website,d.country,d.founded_year,d.sector,
 d.source_name,d.source_url,d.source_license,d.as_of,d.created_at,d.updated_at,
 d.sic_codes,d.competitor_status,d.diligence_status,d.employee_as_of,d.employee_count,
 d.employee_growth_pct,d.funding_currency,d.funding_total,d.last_funding_amount,
 d.last_funding_currency,d.last_funding_date,d.last_funding_type,d.market_share_as_of,
 d.market_share_pct,d.metrics_confidence,d.metrics_evidence_json,d.metrics_source_name,
 d.metrics_source_url,d.metrics_updated_at,d.revenue,d.revenue_as_of,d.revenue_currency,
 d.valuation,d.valuation_as_of,d.valuation_currency,d.website_verified_at,CASE r.reason_code
 WHEN 'verified' THEN 'The recorded evidence has been checked.'
 WHEN 'quality_hold' THEN 'This record is held while its quality is checked.'
 WHEN 'identity_uncertain' THEN 'This company’s identity needs confirmation.'
 WHEN 'source_unavailable' THEN 'The source could not be checked.'
 WHEN 'out_of_scope' THEN 'This record is outside the directory’s scope.'
 WHEN 'source_withdrawn' THEN 'The source has been withdrawn.'
 ELSE 'No review recorded' END AS reason,
 CASE WHEN r.status IS NULL THEN 'No review recorded' ELSE r.status END AS review_label,
 COALESCE(r.status,'not_recorded') AS review_status,r.reason_code,r.next_review_on,r.withdrawn_on
 FROM research_company_directory d LEFT JOIN research_company_reviews r ON r.uid=d.uid
 WHERE NOT EXISTS (SELECT 1 FROM research_company_reviews blocked
   WHERE blocked.uid=d.uid AND blocked.status IN ('excluded','withdrawn'))) AS c WHERE c.uid = 'synthetic-7828-brindlemoor')
ON CONFLICT (company_uid, fact_key) DO NOTHING;

-- synthetic-7828-brindlemoor bm-contact
INSERT INTO research_company_facts
  (company_uid, fact_key, attribute, value, statement_type, source_url, publisher, passage, source_field,
   market_country, published_at, retrieved_at, reviewed_at, reviewed_by, state, conflicts_with_key, replaces_key, manifest_name)
SELECT 'synthetic-7828-brindlemoor', 'bm-contact', 'contact_path', NULL, 'company_statement', 'https://brindlemoor.example/contact', 'Brindlemoor website', NULL, NULL,
  NULL, NULL, '2026-11-02', '2026-11-20', 'Synthetic reviewer', 'source_unavailable', NULL, NULL, 'fixture-7828'
 WHERE EXISTS (SELECT 1 FROM (SELECT d.id,d.uid,d.name,d.website,d.country,d.founded_year,d.sector,
 d.source_name,d.source_url,d.source_license,d.as_of,d.created_at,d.updated_at,
 d.sic_codes,d.competitor_status,d.diligence_status,d.employee_as_of,d.employee_count,
 d.employee_growth_pct,d.funding_currency,d.funding_total,d.last_funding_amount,
 d.last_funding_currency,d.last_funding_date,d.last_funding_type,d.market_share_as_of,
 d.market_share_pct,d.metrics_confidence,d.metrics_evidence_json,d.metrics_source_name,
 d.metrics_source_url,d.metrics_updated_at,d.revenue,d.revenue_as_of,d.revenue_currency,
 d.valuation,d.valuation_as_of,d.valuation_currency,d.website_verified_at,CASE r.reason_code
 WHEN 'verified' THEN 'The recorded evidence has been checked.'
 WHEN 'quality_hold' THEN 'This record is held while its quality is checked.'
 WHEN 'identity_uncertain' THEN 'This company’s identity needs confirmation.'
 WHEN 'source_unavailable' THEN 'The source could not be checked.'
 WHEN 'out_of_scope' THEN 'This record is outside the directory’s scope.'
 WHEN 'source_withdrawn' THEN 'The source has been withdrawn.'
 ELSE 'No review recorded' END AS reason,
 CASE WHEN r.status IS NULL THEN 'No review recorded' ELSE r.status END AS review_label,
 COALESCE(r.status,'not_recorded') AS review_status,r.reason_code,r.next_review_on,r.withdrawn_on
 FROM research_company_directory d LEFT JOIN research_company_reviews r ON r.uid=d.uid
 WHERE NOT EXISTS (SELECT 1 FROM research_company_reviews blocked
   WHERE blocked.uid=d.uid AND blocked.status IN ('excluded','withdrawn'))) AS c WHERE c.uid = 'synthetic-7828-brindlemoor')
ON CONFLICT (company_uid, fact_key) DO NOTHING;

-- synthetic-7828-absent ab-product
INSERT INTO research_company_facts
  (company_uid, fact_key, attribute, value, statement_type, source_url, publisher, passage, source_field,
   market_country, published_at, retrieved_at, reviewed_at, reviewed_by, state, conflicts_with_key, replaces_key, manifest_name)
SELECT 'synthetic-7828-absent', 'ab-product', 'product', 'A product of a company the directory does not hold', 'company_statement', 'https://absent.example/', 'Absent website', 'A company the directory does not hold.', NULL,
  NULL, NULL, '2026-11-02', '2026-11-20', 'Synthetic reviewer', 'found', NULL, NULL, 'fixture-7828'
 WHERE EXISTS (SELECT 1 FROM (SELECT d.id,d.uid,d.name,d.website,d.country,d.founded_year,d.sector,
 d.source_name,d.source_url,d.source_license,d.as_of,d.created_at,d.updated_at,
 d.sic_codes,d.competitor_status,d.diligence_status,d.employee_as_of,d.employee_count,
 d.employee_growth_pct,d.funding_currency,d.funding_total,d.last_funding_amount,
 d.last_funding_currency,d.last_funding_date,d.last_funding_type,d.market_share_as_of,
 d.market_share_pct,d.metrics_confidence,d.metrics_evidence_json,d.metrics_source_name,
 d.metrics_source_url,d.metrics_updated_at,d.revenue,d.revenue_as_of,d.revenue_currency,
 d.valuation,d.valuation_as_of,d.valuation_currency,d.website_verified_at,CASE r.reason_code
 WHEN 'verified' THEN 'The recorded evidence has been checked.'
 WHEN 'quality_hold' THEN 'This record is held while its quality is checked.'
 WHEN 'identity_uncertain' THEN 'This company’s identity needs confirmation.'
 WHEN 'source_unavailable' THEN 'The source could not be checked.'
 WHEN 'out_of_scope' THEN 'This record is outside the directory’s scope.'
 WHEN 'source_withdrawn' THEN 'The source has been withdrawn.'
 ELSE 'No review recorded' END AS reason,
 CASE WHEN r.status IS NULL THEN 'No review recorded' ELSE r.status END AS review_label,
 COALESCE(r.status,'not_recorded') AS review_status,r.reason_code,r.next_review_on,r.withdrawn_on
 FROM research_company_directory d LEFT JOIN research_company_reviews r ON r.uid=d.uid
 WHERE NOT EXISTS (SELECT 1 FROM research_company_reviews blocked
   WHERE blocked.uid=d.uid AND blocked.status IN ('excluded','withdrawn'))) AS c WHERE c.uid = 'synthetic-7828-absent')
ON CONFLICT (company_uid, fact_key) DO NOTHING;

-- synthetic-7828-withdrawn wd-product
INSERT INTO research_company_facts
  (company_uid, fact_key, attribute, value, statement_type, source_url, publisher, passage, source_field,
   market_country, published_at, retrieved_at, reviewed_at, reviewed_by, state, conflicts_with_key, replaces_key, manifest_name)
SELECT 'synthetic-7828-withdrawn', 'wd-product', 'product', 'A product of a withdrawn record', 'company_statement', 'https://withdrawn.example/', 'Withdrawn website', 'A record the directory no longer serves.', NULL,
  NULL, NULL, '2026-11-02', '2026-11-20', 'Synthetic reviewer', 'found', NULL, NULL, 'fixture-7828'
 WHERE EXISTS (SELECT 1 FROM (SELECT d.id,d.uid,d.name,d.website,d.country,d.founded_year,d.sector,
 d.source_name,d.source_url,d.source_license,d.as_of,d.created_at,d.updated_at,
 d.sic_codes,d.competitor_status,d.diligence_status,d.employee_as_of,d.employee_count,
 d.employee_growth_pct,d.funding_currency,d.funding_total,d.last_funding_amount,
 d.last_funding_currency,d.last_funding_date,d.last_funding_type,d.market_share_as_of,
 d.market_share_pct,d.metrics_confidence,d.metrics_evidence_json,d.metrics_source_name,
 d.metrics_source_url,d.metrics_updated_at,d.revenue,d.revenue_as_of,d.revenue_currency,
 d.valuation,d.valuation_as_of,d.valuation_currency,d.website_verified_at,CASE r.reason_code
 WHEN 'verified' THEN 'The recorded evidence has been checked.'
 WHEN 'quality_hold' THEN 'This record is held while its quality is checked.'
 WHEN 'identity_uncertain' THEN 'This company’s identity needs confirmation.'
 WHEN 'source_unavailable' THEN 'The source could not be checked.'
 WHEN 'out_of_scope' THEN 'This record is outside the directory’s scope.'
 WHEN 'source_withdrawn' THEN 'The source has been withdrawn.'
 ELSE 'No review recorded' END AS reason,
 CASE WHEN r.status IS NULL THEN 'No review recorded' ELSE r.status END AS review_label,
 COALESCE(r.status,'not_recorded') AS review_status,r.reason_code,r.next_review_on,r.withdrawn_on
 FROM research_company_directory d LEFT JOIN research_company_reviews r ON r.uid=d.uid
 WHERE NOT EXISTS (SELECT 1 FROM research_company_reviews blocked
   WHERE blocked.uid=d.uid AND blocked.status IN ('excluded','withdrawn'))) AS c WHERE c.uid = 'synthetic-7828-withdrawn')
ON CONFLICT (company_uid, fact_key) DO NOTHING;
