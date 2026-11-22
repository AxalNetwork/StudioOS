-- import-fund-facts v1
-- D7843 (#7843): compiled by scripts/import-fund-facts.mjs from the reviewed manifest "fixture-7843".
-- Regenerate and verify with --check; never edit by hand. Writes research_fund_observations and
-- research_fund_observation_terms only (D7743). Every statement: promoted_by_user_id NULL, promoted_at NULL,
-- method 'manual', imported_on 2026-11-21.
-- manifest sha256 6aab10a4e422ac42a1c09fb062fe37e3158db543b889baec8f87787deacb97ef
-- row tw-name manager_name 4e57a15fa6b62892b49e695846dccade7f1904bb76b4dea0fa2f98494dfab2cf
-- row tw-stage investment_stage 30c4de6c35c2c01de68bba44282bf25edffee6de1d6609c762b3ff195a020793
-- row tw-geo investment_geography c2396ce11c2ee69c5270907458240feb33b46849473fd5d714916cd0ffeb1116
-- row tw-cheque initial_cheque 1a13bb4280facd1d1e6f31052c5d018bb5cfac0e3a491a9a9ab3785f56f8f9e7
-- row pc-cheque initial_cheque 1baf55703709420a27e534b232feeb81023757e5dbe8b6826cd2d0c3eec39ede
-- row mb-cheque initial_cheque 3b7503a49920c95e42e93bf45d756c0bd5fb702c375c80336f33173169912999
-- row pc-cheque-sheet initial_cheque a4eb21263849ae1597cc9f7e1e028e2dd658861ab0f02b6f9799bb4952fa1fae
-- row mb-capital stated_fund_capital 0c68e4f80518c3e4d6502141ce8c1d0f3a9e529574e901940e5b7c82553c8531
-- row mb-lead lead_preference 281313fff05c429320e07e4114372a80eda46092d4729a53ca2a949b9d773051
-- row mb-sector-1 sector_focus 7a9ff4500d38a0ae50bff88529b9e072c30c80307b6b880c9d4db6bf89a3a414
-- row mb-sector-2 sector_focus 766e47c03671d86bcd8092fc9fe80b7b724af423d2f4afa263d04d405d855409
-- row gh-desc description b1ee82e31f409e78f4d8b2e3049f0167f188353665c90bf9637a35f9f2285c90
-- row so-interests interests 9b56b48b7e1e8de06d3f52c70469179996f39c0be655c939f13e8115b7eab17d

-- tw-name
INSERT INTO research_fund_observations
  (fund_uid, fact, wording, source_name, source_url, source_record_ref, reported_on, period_start, period_end,
   imported_on, promoted_by_user_id, promoted_at, method, qualifier, min_cents, max_cents, point_cents,
   currency, currency_basis, review_flags)
SELECT COALESCE((SELECT m.new_uid FROM research_fund_directory_uid_moves m WHERE m.old_uid = 'tidewater-partners'), 'tidewater-partners'), 'manager_name', 'Tidewater Partners', 'Quill Meadow Investor Notes', 'https://tidewater.example/about', 'tw-name', '2026-10-02', NULL, NULL,
  '2026-11-21', NULL, NULL, 'manual', NULL, NULL, NULL, NULL,
  NULL, NULL, NULL
 WHERE EXISTS (SELECT 1 FROM (SELECT * FROM research_fund_directory d WHERE NOT EXISTS (
  SELECT 1 FROM research_fund_sources s WHERE s.source_name = d.source_name AND s.verdict = 'not allowed')) AS f WHERE f.uid = COALESCE((SELECT m.new_uid FROM research_fund_directory_uid_moves m WHERE m.old_uid = 'tidewater-partners'), 'tidewater-partners'))
   AND NOT EXISTS (SELECT 1 FROM research_fund_sources s WHERE s.source_name = 'Quill Meadow Investor Notes' AND s.verdict = 'not allowed')
ON CONFLICT (fund_uid, fact, source_name, source_record_ref) DO NOTHING;

-- tw-stage
INSERT INTO research_fund_observations
  (fund_uid, fact, wording, source_name, source_url, source_record_ref, reported_on, period_start, period_end,
   imported_on, promoted_by_user_id, promoted_at, method, qualifier, min_cents, max_cents, point_cents,
   currency, currency_basis, review_flags)
SELECT COALESCE((SELECT m.new_uid FROM research_fund_directory_uid_moves m WHERE m.old_uid = 'tidewater-partners'), 'tidewater-partners'), 'investment_stage', 'Pre-seed to Series A', 'Quill Meadow Investor Notes', 'https://tidewater.example/approach', 'tw-stage', '2026-10-02', NULL, NULL,
  '2026-11-21', NULL, NULL, 'manual', NULL, NULL, NULL, NULL,
  NULL, NULL, NULL
 WHERE EXISTS (SELECT 1 FROM (SELECT * FROM research_fund_directory d WHERE NOT EXISTS (
  SELECT 1 FROM research_fund_sources s WHERE s.source_name = d.source_name AND s.verdict = 'not allowed')) AS f WHERE f.uid = COALESCE((SELECT m.new_uid FROM research_fund_directory_uid_moves m WHERE m.old_uid = 'tidewater-partners'), 'tidewater-partners'))
   AND NOT EXISTS (SELECT 1 FROM research_fund_sources s WHERE s.source_name = 'Quill Meadow Investor Notes' AND s.verdict = 'not allowed')
ON CONFLICT (fund_uid, fact, source_name, source_record_ref) DO NOTHING;
INSERT INTO research_fund_observation_terms (observation_id, vocabulary, term)
SELECT id, 'stage', 'pre_seed' FROM research_fund_observations WHERE fund_uid = COALESCE((SELECT m.new_uid FROM research_fund_directory_uid_moves m WHERE m.old_uid = 'tidewater-partners'), 'tidewater-partners') AND fact = 'investment_stage' AND source_name = 'Quill Meadow Investor Notes' AND source_record_ref = 'tw-stage'
ON CONFLICT (observation_id, vocabulary, term) DO NOTHING;
INSERT INTO research_fund_observation_terms (observation_id, vocabulary, term)
SELECT id, 'stage', 'seed' FROM research_fund_observations WHERE fund_uid = COALESCE((SELECT m.new_uid FROM research_fund_directory_uid_moves m WHERE m.old_uid = 'tidewater-partners'), 'tidewater-partners') AND fact = 'investment_stage' AND source_name = 'Quill Meadow Investor Notes' AND source_record_ref = 'tw-stage'
ON CONFLICT (observation_id, vocabulary, term) DO NOTHING;
INSERT INTO research_fund_observation_terms (observation_id, vocabulary, term)
SELECT id, 'stage', 'series_a' FROM research_fund_observations WHERE fund_uid = COALESCE((SELECT m.new_uid FROM research_fund_directory_uid_moves m WHERE m.old_uid = 'tidewater-partners'), 'tidewater-partners') AND fact = 'investment_stage' AND source_name = 'Quill Meadow Investor Notes' AND source_record_ref = 'tw-stage'
ON CONFLICT (observation_id, vocabulary, term) DO NOTHING;

-- tw-geo
INSERT INTO research_fund_observations
  (fund_uid, fact, wording, source_name, source_url, source_record_ref, reported_on, period_start, period_end,
   imported_on, promoted_by_user_id, promoted_at, method, qualifier, min_cents, max_cents, point_cents,
   currency, currency_basis, review_flags)
SELECT COALESCE((SELECT m.new_uid FROM research_fund_directory_uid_moves m WHERE m.old_uid = 'tidewater-partners'), 'tidewater-partners'), 'investment_geography', 'Germany and France; the Nordics; Europe', 'Quill Meadow Investor Notes', 'https://tidewater.example/approach', 'tw-geo', '2026-10-02', NULL, NULL,
  '2026-11-21', NULL, NULL, 'manual', NULL, NULL, NULL, NULL,
  NULL, NULL, NULL
 WHERE EXISTS (SELECT 1 FROM (SELECT * FROM research_fund_directory d WHERE NOT EXISTS (
  SELECT 1 FROM research_fund_sources s WHERE s.source_name = d.source_name AND s.verdict = 'not allowed')) AS f WHERE f.uid = COALESCE((SELECT m.new_uid FROM research_fund_directory_uid_moves m WHERE m.old_uid = 'tidewater-partners'), 'tidewater-partners'))
   AND NOT EXISTS (SELECT 1 FROM research_fund_sources s WHERE s.source_name = 'Quill Meadow Investor Notes' AND s.verdict = 'not allowed')
ON CONFLICT (fund_uid, fact, source_name, source_record_ref) DO NOTHING;
INSERT INTO research_fund_observation_terms (observation_id, vocabulary, term)
SELECT id, 'country', 'DE' FROM research_fund_observations WHERE fund_uid = COALESCE((SELECT m.new_uid FROM research_fund_directory_uid_moves m WHERE m.old_uid = 'tidewater-partners'), 'tidewater-partners') AND fact = 'investment_geography' AND source_name = 'Quill Meadow Investor Notes' AND source_record_ref = 'tw-geo'
ON CONFLICT (observation_id, vocabulary, term) DO NOTHING;
INSERT INTO research_fund_observation_terms (observation_id, vocabulary, term)
SELECT id, 'country', 'FR' FROM research_fund_observations WHERE fund_uid = COALESCE((SELECT m.new_uid FROM research_fund_directory_uid_moves m WHERE m.old_uid = 'tidewater-partners'), 'tidewater-partners') AND fact = 'investment_geography' AND source_name = 'Quill Meadow Investor Notes' AND source_record_ref = 'tw-geo'
ON CONFLICT (observation_id, vocabulary, term) DO NOTHING;
INSERT INTO research_fund_observation_terms (observation_id, vocabulary, term)
SELECT id, 'region', 'Europe' FROM research_fund_observations WHERE fund_uid = COALESCE((SELECT m.new_uid FROM research_fund_directory_uid_moves m WHERE m.old_uid = 'tidewater-partners'), 'tidewater-partners') AND fact = 'investment_geography' AND source_name = 'Quill Meadow Investor Notes' AND source_record_ref = 'tw-geo'
ON CONFLICT (observation_id, vocabulary, term) DO NOTHING;

-- tw-cheque
INSERT INTO research_fund_observations
  (fund_uid, fact, wording, source_name, source_url, source_record_ref, reported_on, period_start, period_end,
   imported_on, promoted_by_user_id, promoted_at, method, qualifier, min_cents, max_cents, point_cents,
   currency, currency_basis, review_flags)
SELECT COALESCE((SELECT m.new_uid FROM research_fund_directory_uid_moves m WHERE m.old_uid = 'tidewater-partners'), 'tidewater-partners'), 'initial_cheque', 'EUR 250k - 1m', 'Quill Meadow Investor Notes', 'https://tidewater.example/approach', 'tw-cheque', '2026-10-02', NULL, NULL,
  '2026-11-21', NULL, NULL, 'manual', 'range', 25000000, 100000000, NULL,
  'EUR', 'stated', NULL
 WHERE EXISTS (SELECT 1 FROM (SELECT * FROM research_fund_directory d WHERE NOT EXISTS (
  SELECT 1 FROM research_fund_sources s WHERE s.source_name = d.source_name AND s.verdict = 'not allowed')) AS f WHERE f.uid = COALESCE((SELECT m.new_uid FROM research_fund_directory_uid_moves m WHERE m.old_uid = 'tidewater-partners'), 'tidewater-partners'))
   AND NOT EXISTS (SELECT 1 FROM research_fund_sources s WHERE s.source_name = 'Quill Meadow Investor Notes' AND s.verdict = 'not allowed')
ON CONFLICT (fund_uid, fact, source_name, source_record_ref) DO NOTHING;

-- pc-cheque
INSERT INTO research_fund_observations
  (fund_uid, fact, wording, source_name, source_url, source_record_ref, reported_on, period_start, period_end,
   imported_on, promoted_by_user_id, promoted_at, method, qualifier, min_cents, max_cents, point_cents,
   currency, currency_basis, review_flags)
SELECT COALESCE((SELECT m.new_uid FROM research_fund_directory_uid_moves m WHERE m.old_uid = 'pinecrest-old'), 'pinecrest-old'), 'initial_cheque', 'Typically USD 500k', 'Harbour Lantern Fund Index', 'https://pinecrest.example/faq', 'pc-cheque', '2026-09-14', NULL, NULL,
  '2026-11-21', NULL, NULL, 'manual', 'typical', NULL, NULL, 50000000,
  'USD', 'stated', NULL
 WHERE EXISTS (SELECT 1 FROM (SELECT * FROM research_fund_directory d WHERE NOT EXISTS (
  SELECT 1 FROM research_fund_sources s WHERE s.source_name = d.source_name AND s.verdict = 'not allowed')) AS f WHERE f.uid = COALESCE((SELECT m.new_uid FROM research_fund_directory_uid_moves m WHERE m.old_uid = 'pinecrest-old'), 'pinecrest-old'))
   AND NOT EXISTS (SELECT 1 FROM research_fund_sources s WHERE s.source_name = 'Harbour Lantern Fund Index' AND s.verdict = 'not allowed')
ON CONFLICT (fund_uid, fact, source_name, source_record_ref) DO NOTHING;

-- mb-cheque
INSERT INTO research_fund_observations
  (fund_uid, fact, wording, source_name, source_url, source_record_ref, reported_on, period_start, period_end,
   imported_on, promoted_by_user_id, promoted_at, method, qualifier, min_cents, max_cents, point_cents,
   currency, currency_basis, review_flags)
SELECT COALESCE((SELECT m.new_uid FROM research_fund_directory_uid_moves m WHERE m.old_uid = 'marrow-i'), 'marrow-i'), 'initial_cheque', 'From $100k', 'Harbour Lantern Fund Index', 'https://marrow.example/founders', 'mb-cheque', '2026-08-30', NULL, NULL,
  '2026-11-21', NULL, NULL, 'manual', 'lower_bound', 10000000, NULL, NULL,
  NULL, 'symbol_only', NULL
 WHERE EXISTS (SELECT 1 FROM (SELECT * FROM research_fund_directory d WHERE NOT EXISTS (
  SELECT 1 FROM research_fund_sources s WHERE s.source_name = d.source_name AND s.verdict = 'not allowed')) AS f WHERE f.uid = COALESCE((SELECT m.new_uid FROM research_fund_directory_uid_moves m WHERE m.old_uid = 'marrow-i'), 'marrow-i'))
   AND NOT EXISTS (SELECT 1 FROM research_fund_sources s WHERE s.source_name = 'Harbour Lantern Fund Index' AND s.verdict = 'not allowed')
ON CONFLICT (fund_uid, fact, source_name, source_record_ref) DO NOTHING;

-- pc-cheque-sheet
INSERT INTO research_fund_observations
  (fund_uid, fact, wording, source_name, source_url, source_record_ref, reported_on, period_start, period_end,
   imported_on, promoted_by_user_id, promoted_at, method, qualifier, min_cents, max_cents, point_cents,
   currency, currency_basis, review_flags)
SELECT COALESCE((SELECT m.new_uid FROM research_fund_directory_uid_moves m WHERE m.old_uid = 'pinecrest-ii'), 'pinecrest-ii'), 'initial_cheque', '250k', 'Harbour Lantern Fund Index', 'https://pinecrest.example/sheet', 'pc-cheque-sheet', '2026-09-14', NULL, NULL,
  '2026-11-21', NULL, NULL, 'manual', 'exact', NULL, NULL, 25000000,
  NULL, 'heading_only', NULL
 WHERE EXISTS (SELECT 1 FROM (SELECT * FROM research_fund_directory d WHERE NOT EXISTS (
  SELECT 1 FROM research_fund_sources s WHERE s.source_name = d.source_name AND s.verdict = 'not allowed')) AS f WHERE f.uid = COALESCE((SELECT m.new_uid FROM research_fund_directory_uid_moves m WHERE m.old_uid = 'pinecrest-ii'), 'pinecrest-ii'))
   AND NOT EXISTS (SELECT 1 FROM research_fund_sources s WHERE s.source_name = 'Harbour Lantern Fund Index' AND s.verdict = 'not allowed')
ON CONFLICT (fund_uid, fact, source_name, source_record_ref) DO NOTHING;

-- mb-capital
INSERT INTO research_fund_observations
  (fund_uid, fact, wording, source_name, source_url, source_record_ref, reported_on, period_start, period_end,
   imported_on, promoted_by_user_id, promoted_at, method, qualifier, min_cents, max_cents, point_cents,
   currency, currency_basis, review_flags)
SELECT COALESCE((SELECT m.new_uid FROM research_fund_directory_uid_moves m WHERE m.old_uid = 'marrow-i'), 'marrow-i'), 'stated_fund_capital', '€40m', 'Harbour Lantern Fund Index', 'https://marrow.example/fund-i', 'mb-capital', '2026-08-30', NULL, NULL,
  '2026-11-21', NULL, NULL, 'manual', 'exact', NULL, NULL, 4000000000,
  NULL, 'symbol_only', NULL
 WHERE EXISTS (SELECT 1 FROM (SELECT * FROM research_fund_directory d WHERE NOT EXISTS (
  SELECT 1 FROM research_fund_sources s WHERE s.source_name = d.source_name AND s.verdict = 'not allowed')) AS f WHERE f.uid = COALESCE((SELECT m.new_uid FROM research_fund_directory_uid_moves m WHERE m.old_uid = 'marrow-i'), 'marrow-i'))
   AND NOT EXISTS (SELECT 1 FROM research_fund_sources s WHERE s.source_name = 'Harbour Lantern Fund Index' AND s.verdict = 'not allowed')
ON CONFLICT (fund_uid, fact, source_name, source_record_ref) DO NOTHING;

-- mb-lead
INSERT INTO research_fund_observations
  (fund_uid, fact, wording, source_name, source_url, source_record_ref, reported_on, period_start, period_end,
   imported_on, promoted_by_user_id, promoted_at, method, qualifier, min_cents, max_cents, point_cents,
   currency, currency_basis, review_flags)
SELECT COALESCE((SELECT m.new_uid FROM research_fund_directory_uid_moves m WHERE m.old_uid = 'marrow-i'), 'marrow-i'), 'lead_preference', 'Leads or co-leads seed rounds', 'Harbour Lantern Fund Index', 'https://marrow.example/founders', 'mb-lead', '2026-08-30', NULL, NULL,
  '2026-11-21', NULL, NULL, 'manual', NULL, NULL, NULL, NULL,
  NULL, NULL, NULL
 WHERE EXISTS (SELECT 1 FROM (SELECT * FROM research_fund_directory d WHERE NOT EXISTS (
  SELECT 1 FROM research_fund_sources s WHERE s.source_name = d.source_name AND s.verdict = 'not allowed')) AS f WHERE f.uid = COALESCE((SELECT m.new_uid FROM research_fund_directory_uid_moves m WHERE m.old_uid = 'marrow-i'), 'marrow-i'))
   AND NOT EXISTS (SELECT 1 FROM research_fund_sources s WHERE s.source_name = 'Harbour Lantern Fund Index' AND s.verdict = 'not allowed')
ON CONFLICT (fund_uid, fact, source_name, source_record_ref) DO NOTHING;

-- mb-sector-1
INSERT INTO research_fund_observations
  (fund_uid, fact, wording, source_name, source_url, source_record_ref, reported_on, period_start, period_end,
   imported_on, promoted_by_user_id, promoted_at, method, qualifier, min_cents, max_cents, point_cents,
   currency, currency_basis, review_flags)
SELECT COALESCE((SELECT m.new_uid FROM research_fund_directory_uid_moves m WHERE m.old_uid = 'marrow-i'), 'marrow-i'), 'sector_focus', 'Climate software', 'Harbour Lantern Fund Index', 'https://marrow.example/thesis', 'mb-sector-1', '2026-05-01', NULL, NULL,
  '2026-11-21', NULL, NULL, 'manual', NULL, NULL, NULL, NULL,
  NULL, NULL, NULL
 WHERE EXISTS (SELECT 1 FROM (SELECT * FROM research_fund_directory d WHERE NOT EXISTS (
  SELECT 1 FROM research_fund_sources s WHERE s.source_name = d.source_name AND s.verdict = 'not allowed')) AS f WHERE f.uid = COALESCE((SELECT m.new_uid FROM research_fund_directory_uid_moves m WHERE m.old_uid = 'marrow-i'), 'marrow-i'))
   AND NOT EXISTS (SELECT 1 FROM research_fund_sources s WHERE s.source_name = 'Harbour Lantern Fund Index' AND s.verdict = 'not allowed')
ON CONFLICT (fund_uid, fact, source_name, source_record_ref) DO NOTHING;

-- mb-sector-2
INSERT INTO research_fund_observations
  (fund_uid, fact, wording, source_name, source_url, source_record_ref, reported_on, period_start, period_end,
   imported_on, promoted_by_user_id, promoted_at, method, qualifier, min_cents, max_cents, point_cents,
   currency, currency_basis, review_flags)
SELECT COALESCE((SELECT m.new_uid FROM research_fund_directory_uid_moves m WHERE m.old_uid = 'marrow-i'), 'marrow-i'), 'sector_focus', 'Climate software and industrial automation', 'Harbour Lantern Fund Index', 'https://marrow.example/thesis', 'mb-sector-2', '2026-09-01', NULL, NULL,
  '2026-11-21', NULL, NULL, 'manual', NULL, NULL, NULL, NULL,
  NULL, NULL, NULL
 WHERE EXISTS (SELECT 1 FROM (SELECT * FROM research_fund_directory d WHERE NOT EXISTS (
  SELECT 1 FROM research_fund_sources s WHERE s.source_name = d.source_name AND s.verdict = 'not allowed')) AS f WHERE f.uid = COALESCE((SELECT m.new_uid FROM research_fund_directory_uid_moves m WHERE m.old_uid = 'marrow-i'), 'marrow-i'))
   AND NOT EXISTS (SELECT 1 FROM research_fund_sources s WHERE s.source_name = 'Harbour Lantern Fund Index' AND s.verdict = 'not allowed')
ON CONFLICT (fund_uid, fact, source_name, source_record_ref) DO NOTHING;
UPDATE research_fund_observations SET period_end = '2026-09-01'
 WHERE source_name = 'Harbour Lantern Fund Index' AND source_record_ref = 'mb-sector-1' AND fact = 'sector_focus'
   AND period_end IS NULL
   AND EXISTS (SELECT 1 FROM research_fund_observations n WHERE n.source_name = 'Harbour Lantern Fund Index' AND n.source_record_ref = 'mb-sector-2' AND n.fact = 'sector_focus');

-- gh-desc
INSERT INTO research_fund_observations
  (fund_uid, fact, wording, source_name, source_url, source_record_ref, reported_on, period_start, period_end,
   imported_on, promoted_by_user_id, promoted_at, method, qualifier, min_cents, max_cents, point_cents,
   currency, currency_basis, review_flags)
SELECT COALESCE((SELECT m.new_uid FROM research_fund_directory_uid_moves m WHERE m.old_uid = 'ghost-fund'), 'ghost-fund'), 'description', 'A fund the directory does not serve', 'Quill Meadow Investor Notes', 'https://ghost.example/', 'gh-desc', '2026-10-02', NULL, NULL,
  '2026-11-21', NULL, NULL, 'manual', NULL, NULL, NULL, NULL,
  NULL, NULL, NULL
 WHERE EXISTS (SELECT 1 FROM (SELECT * FROM research_fund_directory d WHERE NOT EXISTS (
  SELECT 1 FROM research_fund_sources s WHERE s.source_name = d.source_name AND s.verdict = 'not allowed')) AS f WHERE f.uid = COALESCE((SELECT m.new_uid FROM research_fund_directory_uid_moves m WHERE m.old_uid = 'ghost-fund'), 'ghost-fund'))
   AND NOT EXISTS (SELECT 1 FROM research_fund_sources s WHERE s.source_name = 'Quill Meadow Investor Notes' AND s.verdict = 'not allowed')
ON CONFLICT (fund_uid, fact, source_name, source_record_ref) DO NOTHING;

-- so-interests
INSERT INTO research_fund_observations
  (fund_uid, fact, wording, source_name, source_url, source_record_ref, reported_on, period_start, period_end,
   imported_on, promoted_by_user_id, promoted_at, method, qualifier, min_cents, max_cents, point_cents,
   currency, currency_basis, review_flags)
SELECT COALESCE((SELECT m.new_uid FROM research_fund_directory_uid_moves m WHERE m.old_uid = 'marrow-i'), 'marrow-i'), 'interests', 'Grid storage', 'Slate Orchard Fund Sheet', 'https://marrow.example/news', 'so-interests', '2026-10-02', NULL, NULL,
  '2026-11-21', NULL, NULL, 'manual', NULL, NULL, NULL, NULL,
  NULL, NULL, NULL
 WHERE EXISTS (SELECT 1 FROM (SELECT * FROM research_fund_directory d WHERE NOT EXISTS (
  SELECT 1 FROM research_fund_sources s WHERE s.source_name = d.source_name AND s.verdict = 'not allowed')) AS f WHERE f.uid = COALESCE((SELECT m.new_uid FROM research_fund_directory_uid_moves m WHERE m.old_uid = 'marrow-i'), 'marrow-i'))
   AND NOT EXISTS (SELECT 1 FROM research_fund_sources s WHERE s.source_name = 'Slate Orchard Fund Sheet' AND s.verdict = 'not allowed')
ON CONFLICT (fund_uid, fact, source_name, source_record_ref) DO NOTHING;
