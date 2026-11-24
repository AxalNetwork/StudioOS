-- D7835 (#7835) — a saved competitive context: what a member's competitor
-- research is about, written once and reused. Owner-private; the routes are
-- `cloudflare-worker/src/routes/research_competitive_contexts.ts`.
--
-- ITS OWN RECORD. A context holds no link to a study: no column references a
-- Research Project, a study or a study segment (#7719 owns a study's scope and
-- nothing here writes it). The only record it may name is a company directory
-- record, by uid, which the Worker checks through the served rows under the
-- Companies rule when it is written.
--
-- SHARED NAMES AND LIMITS. `product` (200), `business_model` (500), `buyer`
-- (200) and `customer_countries_json` (a JSON array, at most 60 two-letter
-- codes) carry the names and limits of the same fields in #7719's migration
-- (202611191832_7719_research_studies.sql). The Worker imports #7719's exported
-- limits, and over a limit is a refusal, never a truncation.
--
-- CUSTOMER COUNTRIES are where the buyers are, never where listed companies
-- are based. They come only from their own field, start empty (NULL) and are
-- checked against `research_countries` by the Worker.
--
-- NULL MEANS NOT WRITTEN, never ''. `version` starts at 1 and every update
-- adds one; a write names the version it read.
--
-- HISTORY. Each saved version is copied whole into
-- `research_competitive_context_versions`, which is never updated (trigger), so
-- a later run can name exactly what it used. Deleting a context deletes its
-- versions with it: the record is owner-private.
--
-- No transaction statements: D1 rejects them (scripts/check-sql-migrations.mjs).

CREATE TABLE IF NOT EXISTS research_competitive_contexts (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  uid                   TEXT NOT NULL UNIQUE CHECK (length(uid) BETWEEN 8 AND 64),
  owner_user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name                  TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 120),
  product               TEXT CHECK (product IS NULL OR length(trim(product)) BETWEEN 1 AND 200),
  directory_record_uid  TEXT CHECK (directory_record_uid IS NULL OR length(directory_record_uid) BETWEEN 1 AND 64),
  buyer                 TEXT CHECK (buyer IS NULL OR length(trim(buyer)) BETWEEN 1 AND 200),
  customer_segment      TEXT CHECK (customer_segment IS NULL OR length(trim(customer_segment)) BETWEEN 1 AND 200),
  customer_problem      TEXT CHECK (customer_problem IS NULL OR length(trim(customer_problem)) BETWEEN 1 AND 1000),
  use_case              TEXT CHECK (use_case IS NULL OR length(trim(use_case)) BETWEEN 1 AND 1000),
  customer_countries_json TEXT CHECK (customer_countries_json IS NULL OR (json_valid(customer_countries_json) AND json_type(customer_countries_json) = 'array' AND length(customer_countries_json) <= 1000)),
  business_model        TEXT CHECK (business_model IS NULL OR length(trim(business_model)) BETWEEN 1 AND 500),
  delivery_model        TEXT CHECK (delivery_model IS NULL OR length(trim(delivery_model)) BETWEEN 1 AND 500),
  purpose               TEXT CHECK (purpose IS NULL OR length(trim(purpose)) BETWEEN 1 AND 1000),
  market_slug           TEXT CHECK (market_slug IS NULL OR length(market_slug) BETWEEN 1 AND 64),
  criteria_json         TEXT CHECK (criteria_json IS NULL OR (json_valid(criteria_json) AND json_type(criteria_json) = 'array' AND length(criteria_json) <= 1000)),
  version               INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at            TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at            TEXT NOT NULL DEFAULT (datetime('now')),
  -- The subject is the member's own product or a directory record, not both.
  CHECK (product IS NULL OR directory_record_uid IS NULL)
);

CREATE INDEX IF NOT EXISTS idx_research_competitive_contexts_owner
  ON research_competitive_contexts(owner_user_id, updated_at);

CREATE TABLE IF NOT EXISTS research_competitive_context_versions (
  context_id   INTEGER NOT NULL REFERENCES research_competitive_contexts(id) ON DELETE CASCADE,
  version      INTEGER NOT NULL CHECK (version >= 1),
  fields_json  TEXT NOT NULL CHECK (json_valid(fields_json) AND json_type(fields_json) = 'object' AND length(fields_json) <= 16000),
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (context_id, version)
);

-- A saved version is a record of what the context said; it is never changed.
CREATE TRIGGER IF NOT EXISTS trg_research_competitive_context_versions_immutable
BEFORE UPDATE ON research_competitive_context_versions
BEGIN
  SELECT RAISE(ABORT, 'research_competitive_context_versions: a saved version is never changed');
END;
