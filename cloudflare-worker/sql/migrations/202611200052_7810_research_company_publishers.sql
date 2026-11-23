-- D7810 (#7810): exact stored publisher references; no directory row is rewritten.
CREATE TABLE IF NOT EXISTS research_company_publishers (
 source_name TEXT PRIMARY KEY NOT NULL,
 publisher TEXT NOT NULL,
 licence_id TEXT NOT NULL,
 licence_name TEXT NOT NULL,
 licence_link TEXT NOT NULL CHECK(licence_link GLOB 'https://?*'),
 required_attribution TEXT,
 evidence_link TEXT NOT NULL CHECK(evidence_link GLOB 'https://?*'),
 terms_reviewed_on TEXT NOT NULL CHECK(date(terms_reviewed_on) IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_research_company_directory_source_name ON research_company_directory(source_name);
-- 228 and 403 record Wikidata's CC0 data. CC0 imposes no attribution requirement.
INSERT INTO research_company_publishers(source_name,publisher,licence_id,licence_name,licence_link,required_attribution,evidence_link,terms_reviewed_on) VALUES
 ('Wikidata','Wikidata','CC0-1.0','CC0 1.0 Universal','https://creativecommons.org/publicdomain/zero/1.0/',NULL,'https://www.wikidata.org/wiki/Wikidata:Licensing','2026-11-20'),
-- Attribution quoted verbatim from migration 405, not invented from a licence identifier.
 ('Companies House','Companies House','OGL-3.0','Open Government Licence v3.0','https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/','Contains public sector information licensed under the Open Government Licence v3.0.','https://download.companieshouse.gov.uk/en_output.html','2026-11-20');
