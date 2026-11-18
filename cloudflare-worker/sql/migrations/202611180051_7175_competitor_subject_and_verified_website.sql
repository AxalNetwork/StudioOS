-- D7175 (#7175, canvas D7041): Research › Companies analysis keeps a fixed subject.
--
-- 1. competitor_analyses.subject_uid — the directory company a run is about
--    (`research_company_directory.uid`, migration 228). Before this the subject
--    lived only as text in `inputs_json.market`, so the results page, the saved
--    list and the export could not name it, and nothing could keep it out of
--    its own candidate list. NULL is a custom-market run: no company is the
--    subject. Existing rows stay NULL; nothing is backfilled from the market
--    text, because a market is not a company.
--
-- 2. research_company_directory.website_verified_at — when someone checked
--    that the recorded website is the company's own. NULL is "Not verified",
--    which every row is today: the directory stores a website with its source
--    and as-of date but no check of it. Nothing in this change writes it; the
--    subject card reads it and says Not verified until a check exists.
--
-- Additive; the ledger applies each ALTER once. No transaction statements: D1
-- rejects `BEGIN;`/`COMMIT;` (see 200's header).
ALTER TABLE competitor_analyses ADD COLUMN subject_uid TEXT;

ALTER TABLE research_company_directory ADD COLUMN website_verified_at TEXT;
