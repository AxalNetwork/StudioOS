-- #4591 (R2-03): declare the five legal-template research objects production
-- already has.
--
-- On 2026-11-06 these objects were created on production by DDL that no file
-- in this repository declares; the first rows are from 16:54Z. Who or what ran
-- that DDL is not known: D1 records no DDL author, and nothing in the repo
-- writes or reads these objects. The owner decided (option B, 2026-11-07) that
-- the five legal_template_* objects are intended and are declared here and in
-- schema_baseline.sql, so a new database comes up matching production.
-- `axal_group_entity_draft_facts`, created in the same window, is not intended
-- and is deliberately not declared: the owner exports and drops it by hand.
--
-- Each statement is production's DDL as its sqlite_master holds it (printed by
-- the deploy job's parity step), with only `IF NOT EXISTS` added, so this file
-- is a no-op on production and creates the objects on any other database.
-- Nothing is renamed and no house-convention column is added: the file has to
-- match production. `legal_templates` comes from 084_legal_templates.sql.

CREATE TABLE IF NOT EXISTS legal_template_research_drafts (id INTEGER PRIMARY KEY AUTOINCREMENT, template_id INTEGER NOT NULL, template_slug TEXT NOT NULL, jurisdiction TEXT NOT NULL, draft_body_md TEXT NOT NULL DEFAULT '', review_notes TEXT NOT NULL, citations_json TEXT NOT NULL DEFAULT '[]', status TEXT NOT NULL DEFAULT 'pending_counsel_review', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE(template_id,jurisdiction), FOREIGN KEY(template_id) REFERENCES legal_templates(id));

CREATE TABLE IF NOT EXISTS legal_template_proposals (id INTEGER PRIMARY KEY AUTOINCREMENT, slug TEXT UNIQUE NOT NULL, title TEXT NOT NULL, entity TEXT NOT NULL, priority TEXT NOT NULL, kind TEXT NOT NULL, draft_body_md TEXT NOT NULL, source_urls_json TEXT NOT NULL DEFAULT '[]', status TEXT NOT NULL DEFAULT 'pending_counsel_review', created_at TEXT DEFAULT CURRENT_TIMESTAMP);

CREATE TABLE IF NOT EXISTS legal_template_review_events (id INTEGER PRIMARY KEY AUTOINCREMENT, template_id INTEGER NOT NULL, review_type TEXT NOT NULL, jurisdiction TEXT, status TEXT NOT NULL DEFAULT 'pending', reviewer TEXT, source_reference TEXT, review_due_at TEXT, reviewed_at TEXT, notes TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY(template_id) REFERENCES legal_templates(id));

CREATE INDEX IF NOT EXISTS idx_legal_template_review_events_status ON legal_template_review_events(status,template_id);

CREATE VIEW IF NOT EXISTS legal_template_research_queue AS SELECT t.id AS template_id,t.slug,t.title,t.category,t.version AS live_version,t.is_stub,d.status AS research_status,d.jurisdiction,d.review_notes,d.citations_json,length(d.draft_body_md) AS draft_chars,d.updated_at FROM legal_templates t JOIN legal_template_research_drafts d ON d.template_id=t.id;
