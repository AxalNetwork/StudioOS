-- D7825 (#7825): record identity for Research company and fund records: names, native identifiers, reviewed domains.
--
-- Keyed as a project subject keys a record: record_kind ('company' | 'fund') and the directory uid. The same name,
-- identifier or host on two records is allowed (no UNIQUE across records): it is a matching clue and never links or
-- merges them. The scheme list holds no Network directory id and no source-list id.
--
-- BACKFILL, by the uid forms main's importers write and no other rule:
--   ch-<number>         (scripts/import-companies-house.mjs)    Companies House number, and the stored name as legal name
--   q<digits>           (scripts/import-wikidata-*.mjs)         the Wikidata id; no legal name
--   no-brreg:<id>       (scripts/import-register-companies.mjs, PR #7559, merged)  BRREG organisation number + legal name
--   fi-prh:<id>         (same)                                  PRH Business ID + legal name
--   ee-rik:<id>         (same)                                  RIK registry code + legal name
-- Every other company record, and every fund, gets no row and reads "Not recorded". How many: every directory row
-- whose uid has none of the five forms, and every fund. The register rules cover the 25,500 uids #7559's audit applied
-- (BRREG 8,750, PRH 8,750, RIK 8,000); the per-form count query (counts only) is in D7825 for after apply. Domains
-- are not copied from the website column: a read gives the recorded website's host as "not reviewed" until a review
-- or an import writes a row.

CREATE TABLE IF NOT EXISTS research_record_names (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 record_kind TEXT NOT NULL CHECK(record_kind IN ('company','fund')),
 record_uid TEXT NOT NULL CHECK(length(record_uid) BETWEEN 1 AND 64),
 name_type TEXT NOT NULL CHECK(name_type IN ('legal','alias','brand','former','match_key')),
 name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 300),
 language TEXT CHECK(language IS NULL OR length(language) BETWEEN 2 AND 16),
 source_name TEXT NOT NULL CHECK(length(source_name) BETWEEN 1 AND 200),
 source_url TEXT CHECK(source_url IS NULL OR source_url GLOB 'https://?*'),
 recorded_on TEXT CHECK(recorded_on IS NULL OR date(recorded_on) IS NOT NULL),
 source_key TEXT CHECK(source_key IS NULL OR length(source_key) <= 200),
 provider_record_id TEXT CHECK(provider_record_id IS NULL OR length(provider_record_id) <= 200),
 stated_row_hash TEXT CHECK(stated_row_hash IS NULL OR length(stated_row_hash) <= 128),
 created_at TEXT NOT NULL DEFAULT (datetime('now')),
 UNIQUE(record_kind, record_uid, name_type, name)
);
CREATE INDEX IF NOT EXISTS idx_research_record_names_record ON research_record_names(record_kind, record_uid);
CREATE INDEX IF NOT EXISTS idx_research_record_names_name ON research_record_names(name_type, name);

CREATE TABLE IF NOT EXISTS research_record_identifiers (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 record_kind TEXT NOT NULL CHECK(record_kind IN ('company','fund')),
 record_uid TEXT NOT NULL CHECK(length(record_uid) BETWEEN 1 AND 64),
 scheme TEXT NOT NULL CHECK(scheme IN ('gb_companies_house','wikidata','no_brreg','fi_prh','ee_rik','lei')),
 value TEXT NOT NULL CHECK(length(trim(value)) BETWEEN 1 AND 100),
 source_name TEXT NOT NULL CHECK(length(source_name) BETWEEN 1 AND 200),
 source_url TEXT CHECK(source_url IS NULL OR source_url GLOB 'https://?*'),
 source_key TEXT CHECK(source_key IS NULL OR length(source_key) <= 200),
 provider_record_id TEXT CHECK(provider_record_id IS NULL OR length(provider_record_id) <= 200),
 stated_row_hash TEXT CHECK(stated_row_hash IS NULL OR length(stated_row_hash) <= 128),
 created_at TEXT NOT NULL DEFAULT (datetime('now')),
 UNIQUE(record_kind, record_uid, scheme, value)
);
CREATE INDEX IF NOT EXISTS idx_research_record_identifiers_record ON research_record_identifiers(record_kind, record_uid);
CREATE INDEX IF NOT EXISTS idx_research_record_identifiers_value ON research_record_identifiers(scheme, value);

CREATE TABLE IF NOT EXISTS research_record_domains (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 record_kind TEXT NOT NULL CHECK(record_kind IN ('company','fund')),
 record_uid TEXT NOT NULL CHECK(length(record_uid) BETWEEN 1 AND 64),
 host TEXT NOT NULL CHECK(length(host) BETWEEN 1 AND 253 AND host = lower(host)),
 review_state TEXT NOT NULL CHECK(review_state IN ('not_reviewed','reviewed','rejected')),
 reviewed_on TEXT CHECK(reviewed_on IS NULL OR datetime(reviewed_on) IS NOT NULL),
 reviewer INTEGER,
 proof_url TEXT CHECK(proof_url IS NULL OR proof_url GLOB 'https://?*'),
 note TEXT CHECK(note IS NULL OR length(note) <= 2000),
 source_name TEXT CHECK(source_name IS NULL OR length(source_name) <= 200),
 updated_at TEXT NOT NULL DEFAULT (datetime('now')),
 CHECK(review_state = 'not_reviewed' OR (reviewed_on IS NOT NULL AND reviewer IS NOT NULL AND proof_url IS NOT NULL)),
 UNIQUE(record_kind, record_uid, host)
);
CREATE INDEX IF NOT EXISTS idx_research_record_domains_host ON research_record_domains(host, review_state);

-- Backfill: Companies House.
INSERT OR IGNORE INTO research_record_identifiers (record_kind, record_uid, scheme, value, source_name, source_url)
 SELECT 'company', uid, 'gb_companies_house', upper(substr(uid, 4)), source_name,
        CASE WHEN source_url GLOB 'https://?*' THEN source_url END
   FROM research_company_directory WHERE uid GLOB 'ch-?*';
INSERT OR IGNORE INTO research_record_names (record_kind, record_uid, name_type, name, source_name, source_url, recorded_on)
 SELECT 'company', uid, 'legal', trim(name), source_name, CASE WHEN source_url GLOB 'https://?*' THEN source_url END,
        CASE WHEN date(as_of) IS NOT NULL THEN date(as_of) END
   FROM research_company_directory WHERE uid GLOB 'ch-?*' AND length(trim(name)) BETWEEN 1 AND 300;

-- Backfill: Wikidata (an id only; a Wikidata label is not a legal name).
INSERT OR IGNORE INTO research_record_identifiers (record_kind, record_uid, scheme, value, source_name, source_url)
 SELECT 'company', uid, 'wikidata', 'Q' || substr(uid, 2), source_name, CASE WHEN source_url GLOB 'https://?*' THEN source_url END
   FROM research_company_directory WHERE uid GLOB 'q[0-9]*' AND substr(uid, 2) NOT GLOB '*[^0-9]*';

-- Backfill: the three primary registers of PR #7559.
INSERT OR IGNORE INTO research_record_identifiers (record_kind, record_uid, scheme, value, source_name, source_url)
 SELECT 'company', uid,
        CASE WHEN uid GLOB 'no-brreg:?*' THEN 'no_brreg' WHEN uid GLOB 'fi-prh:?*' THEN 'fi_prh' ELSE 'ee_rik' END,
        substr(uid, instr(uid, ':') + 1), source_name, CASE WHEN source_url GLOB 'https://?*' THEN source_url END
   FROM research_company_directory WHERE uid GLOB 'no-brreg:?*' OR uid GLOB 'fi-prh:?*' OR uid GLOB 'ee-rik:?*';
INSERT OR IGNORE INTO research_record_names (record_kind, record_uid, name_type, name, source_name, source_url, recorded_on)
 SELECT 'company', uid, 'legal', trim(name), source_name, CASE WHEN source_url GLOB 'https://?*' THEN source_url END,
        CASE WHEN date(as_of) IS NOT NULL THEN date(as_of) END
   FROM research_company_directory WHERE (uid GLOB 'no-brreg:?*' OR uid GLOB 'fi-prh:?*' OR uid GLOB 'ee-rik:?*')
    AND length(trim(name)) BETWEEN 1 AND 300;
