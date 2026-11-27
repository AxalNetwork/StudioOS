-- D7821: native activity evidence, reviewed code crosswalk and explainable stored company mapping.
ALTER TABLE research_taxonomy_overrides ADD COLUMN author INTEGER REFERENCES users(id);
CREATE TABLE research_company_classifications (
 company_uid TEXT NOT NULL REFERENCES research_company_directory(uid) ON DELETE CASCADE,
 scheme TEXT NOT NULL,
 scheme_version TEXT NOT NULL,
 code TEXT,
 native_label TEXT,
 language TEXT,
 source TEXT NOT NULL,
 position INTEGER NOT NULL CHECK(position >= 0),
 PRIMARY KEY(company_uid, scheme, scheme_version, position),
 CHECK(code IS NOT NULL OR native_label IS NOT NULL)
);
CREATE INDEX idx_company_classifications_scheme ON research_company_classifications(scheme, scheme_version, code);
CREATE TABLE research_classification_crosswalk (
 scheme TEXT NOT NULL,
 scheme_version TEXT NOT NULL,
 code TEXT NOT NULL CHECK(length(code) > 0),
 match_kind TEXT NOT NULL CHECK(match_kind IN ('exact','prefix')),
 normalized_scheme TEXT NOT NULL,
 normalized_version TEXT NOT NULL,
 industry_code TEXT NOT NULL CHECK(length(industry_code) > 0),
 industry_title TEXT NOT NULL CHECK(length(industry_title) > 0),
 state TEXT NOT NULL CHECK(state IN ('mapped','outside_tracked_markets')),
 market_slug TEXT REFERENCES research_market_directory(slug),
 reason TEXT NOT NULL CHECK(length(trim(reason)) > 0),
 reviewed_on TEXT NOT NULL,
 reviewer TEXT NOT NULL CHECK(length(trim(reviewer)) > 0),
 PRIMARY KEY(scheme, scheme_version, code, match_kind),
 CHECK((state = 'mapped' AND market_slug IS NOT NULL) OR (state = 'outside_tracked_markets' AND market_slug IS NULL))
);
CREATE TABLE research_company_mapping (
 company_uid TEXT PRIMARY KEY REFERENCES research_company_directory(uid) ON DELETE CASCADE,
 state TEXT NOT NULL CHECK(state IN ('mapped','no_label','not_yet_considered','outside_tracked_markets','pinned_unmapped_by_hand')),
 market_slug TEXT REFERENCES research_market_directory(slug),
 method TEXT CHECK(method IN ('rule','code','manual')),
 proof TEXT NOT NULL CHECK(json_valid(proof)),
 rules_version TEXT NOT NULL,
 mapped_on TEXT NOT NULL,
 CHECK((state = 'mapped' AND market_slug IS NOT NULL) OR (state != 'mapped' AND market_slug IS NULL)),
 CHECK(state != 'pinned_unmapped_by_hand' OR method = 'manual')
);
CREATE TABLE research_company_mapping_revision (
 id INTEGER PRIMARY KEY CHECK(id = 1),
 revision INTEGER NOT NULL CHECK(revision >= 0)
);
INSERT INTO research_company_mapping_revision(id,revision) VALUES(1,0);
-- Preserve every comma-separated UK SIC code in register order. Sector is our old crosswalk label, NOT a native label.
WITH RECURSIVE codes(company_uid, rest, code, position) AS (
 SELECT uid, COALESCE(sic_codes,'') || ',', NULL, -1 FROM research_company_directory WHERE source_name = 'Companies House'
 UNION ALL
 SELECT company_uid, substr(rest,instr(rest,',')+1), trim(substr(rest,1,instr(rest,',')-1)), position+1 FROM codes WHERE rest != ''
)
INSERT INTO research_company_classifications(company_uid,scheme,scheme_version,code,native_label,language,source,position)
 SELECT company_uid,'UK SIC','2007',code,NULL,NULL,'Companies House',position FROM codes WHERE code IS NOT NULL AND code != '';
