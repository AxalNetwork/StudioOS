-- D6700 (#6700): immutable, jurisdiction-bound review of catalogue submissions.
-- Version 1 keeps its migration publication. Only new submissions use these columns.
ALTER TABLE formation_catalogue_versions ADD COLUMN draft_base_id INTEGER REFERENCES formation_catalogue_versions(id);
ALTER TABLE formation_catalogue_versions ADD COLUMN content_revision INTEGER NOT NULL DEFAULT 0;
ALTER TABLE formation_catalogue_versions ADD COLUMN review_round TEXT;
ALTER TABLE formation_catalogue_versions ADD COLUMN review_base_id INTEGER REFERENCES formation_catalogue_versions(id);
ALTER TABLE formation_catalogue_versions ADD COLUMN review_content_sha256 TEXT;
ALTER TABLE formation_catalogue_versions ADD COLUMN review_rules_sha256 TEXT;
ALTER TABLE formation_catalogue_versions ADD COLUMN review_countries TEXT CHECK (review_countries IS NULL OR json_valid(review_countries));
ALTER TABLE formation_catalogue_versions ADD COLUMN review_editor_id INTEGER;

-- Validate the clone's base and single-open rule inside the editor's copy batch.
CREATE TRIGGER IF NOT EXISTS formation_clone_current_base BEFORE INSERT ON formation_catalogue_versions
WHEN NEW.draft_base_id IS NOT NULL AND (
  NEW.status <> 'draft' OR EXISTS (SELECT 1 FROM formation_catalogue_versions WHERE status IN ('draft','in_review'))
  OR NOT EXISTS (SELECT 1 FROM formation_catalogue_versions WHERE id = NEW.draft_base_id AND is_current = 1))
BEGIN SELECT RAISE(ABORT, 'formation_catalogue_versions.draft_base_id: clone conflict'); END;

CREATE TABLE IF NOT EXISTS formation_counsel_admissions (
  user_id INTEGER NOT NULL REFERENCES counsel_members(user_id) ON DELETE CASCADE,
  country TEXT NOT NULL CHECK (country GLOB '[A-Z][A-Z]'),
  granted_by INTEGER NOT NULL,
  PRIMARY KEY (user_id, country)
);

CREATE TABLE IF NOT EXISTS formation_reviews (
  id INTEGER PRIMARY KEY,
  version_id INTEGER NOT NULL REFERENCES formation_catalogue_versions(id),
  review_round TEXT NOT NULL,
  object_kind TEXT NOT NULL CHECK (object_kind IN ('rule_set', 'form')),
  object_ref TEXT NOT NULL CHECK (length(object_ref) BETWEEN 1 AND 120),
  content_sha256 TEXT NOT NULL CHECK (length(content_sha256) = 64 AND content_sha256 NOT GLOB '*[^0-9a-f]*'),
  jurisdiction TEXT NOT NULL CHECK (jurisdiction GLOB '[A-Z][A-Z]'),
  reviewer_id INTEGER NOT NULL,
  decision TEXT CHECK (decision IN ('approved', 'not_approved')),
  decided_at TEXT,
  CHECK ((decision IS NULL) = (decided_at IS NULL)),
  UNIQUE (review_round, object_kind, object_ref, jurisdiction)
);
CREATE INDEX IF NOT EXISTS ix_formation_reviews_assigned ON formation_reviews(reviewer_id, version_id);

-- REPLACE can implicitly delete a row without firing DELETE triggers with
-- SQLite's default recursive_triggers setting. Refuse either identity collision.
CREATE TRIGGER IF NOT EXISTS formation_reviews_no_replace BEFORE INSERT ON formation_reviews
WHEN EXISTS (SELECT 1 FROM formation_reviews r WHERE r.id = NEW.id OR
  (r.review_round = NEW.review_round AND r.object_kind = NEW.object_kind AND r.object_ref = NEW.object_ref AND r.jurisdiction = NEW.jurisdiction))
BEGIN SELECT RAISE(ABORT, 'formation_reviews.id: immutable review'); END;

CREATE TRIGGER IF NOT EXISTS formation_reviews_requested BEFORE INSERT ON formation_reviews
WHEN NEW.decision IS NOT NULL OR NOT EXISTS (
  SELECT 1 FROM formation_counsel_admissions a JOIN counsel_members c ON c.user_id = a.user_id
   WHERE a.user_id = NEW.reviewer_id AND a.country = NEW.jurisdiction)
BEGIN SELECT RAISE(ABORT, 'formation_reviews.reviewer_id: admitted counsel required'); END;

CREATE TRIGGER IF NOT EXISTS formation_reviews_decide_once BEFORE UPDATE ON formation_reviews
WHEN OLD.decision IS NOT NULL OR NEW.decision IS NULL OR NEW.id IS NOT OLD.id
  OR NEW.version_id IS NOT OLD.version_id OR NEW.review_round IS NOT OLD.review_round
  OR NEW.object_kind IS NOT OLD.object_kind OR NEW.object_ref IS NOT OLD.object_ref
  OR NEW.content_sha256 IS NOT OLD.content_sha256 OR NEW.jurisdiction IS NOT OLD.jurisdiction
  OR NEW.reviewer_id IS NOT OLD.reviewer_id OR NOT EXISTS (
    SELECT 1 FROM formation_counsel_admissions a JOIN counsel_members c ON c.user_id = a.user_id
     WHERE a.user_id = NEW.reviewer_id AND a.country = NEW.jurisdiction)
BEGIN SELECT RAISE(ABORT, 'formation_reviews.decision: immutable request or decision'); END;
CREATE TRIGGER IF NOT EXISTS formation_reviews_no_delete BEFORE DELETE ON formation_reviews
BEGIN SELECT RAISE(ABORT, 'formation_reviews.id: reviews cannot be deleted'); END;

-- The editor may have read a draft just before submission. Every child write
-- increments this counter in its own transaction, including a move between versions.
-- Once frozen, aborting that increment also rolls back the child write.
CREATE TRIGGER IF NOT EXISTS formation_revision_draft_only BEFORE UPDATE OF content_revision ON formation_catalogue_versions
WHEN OLD.status <> 'draft'
BEGIN SELECT RAISE(ABORT, 'formation_catalogue_versions.content_revision: immutable while in review or published'); END;

CREATE TRIGGER IF NOT EXISTS formation_published_review_immutable
BEFORE UPDATE OF draft_base_id, review_round, review_base_id, review_content_sha256, review_rules_sha256, review_countries, review_editor_id
ON formation_catalogue_versions WHEN OLD.status IN ('published','retired')
BEGIN SELECT RAISE(ABORT, 'formation_catalogue_versions.review_round: immutable publication record'); END;

-- The guarded UPDATE that promotes a candidate fires this only if a row actually
-- qualifies. SQLite rolls both changes back together if any constraint or audit fails.
CREATE TRIGGER IF NOT EXISTS formation_publish_retire_previous BEFORE UPDATE OF is_current ON formation_catalogue_versions
WHEN OLD.status = 'in_review' AND NEW.status = 'published' AND NEW.is_current = 1
BEGIN
  UPDATE formation_catalogue_versions SET status = 'retired', is_current = 0, retired_at = NEW.published_at
   WHERE id = OLD.review_base_id AND is_current = 1;
END;

CREATE TRIGGER IF NOT EXISTS formation_jurisdictions_revision_insert AFTER INSERT ON formation_jurisdictions
BEGIN
  UPDATE formation_catalogue_versions SET content_revision = content_revision + 1 WHERE id = NEW.version_id;
END;

CREATE TRIGGER IF NOT EXISTS formation_jurisdictions_revision_update AFTER UPDATE ON formation_jurisdictions
BEGIN
  UPDATE formation_catalogue_versions SET content_revision = content_revision + 1 WHERE id IN (OLD.version_id, NEW.version_id);
END;

CREATE TRIGGER IF NOT EXISTS formation_jurisdictions_revision_delete AFTER DELETE ON formation_jurisdictions
BEGIN
  UPDATE formation_catalogue_versions SET content_revision = content_revision + 1 WHERE id = OLD.version_id;
END;

CREATE TRIGGER IF NOT EXISTS formation_entity_forms_revision_insert AFTER INSERT ON formation_entity_forms
BEGIN
  UPDATE formation_catalogue_versions SET content_revision = content_revision + 1 WHERE id = NEW.version_id;
END;

CREATE TRIGGER IF NOT EXISTS formation_entity_forms_revision_update AFTER UPDATE ON formation_entity_forms
BEGIN
  UPDATE formation_catalogue_versions SET content_revision = content_revision + 1 WHERE id IN (OLD.version_id, NEW.version_id);
END;

CREATE TRIGGER IF NOT EXISTS formation_entity_forms_revision_delete AFTER DELETE ON formation_entity_forms
BEGIN
  UPDATE formation_catalogue_versions SET content_revision = content_revision + 1 WHERE id = OLD.version_id;
END;

CREATE TRIGGER IF NOT EXISTS formation_form_facts_revision_insert AFTER INSERT ON formation_form_facts
BEGIN
  UPDATE formation_catalogue_versions SET content_revision = content_revision + 1 WHERE id = NEW.version_id;
END;

CREATE TRIGGER IF NOT EXISTS formation_form_facts_revision_update AFTER UPDATE ON formation_form_facts
BEGIN
  UPDATE formation_catalogue_versions SET content_revision = content_revision + 1 WHERE id IN (OLD.version_id, NEW.version_id);
END;

CREATE TRIGGER IF NOT EXISTS formation_form_facts_revision_delete AFTER DELETE ON formation_form_facts
BEGIN
  UPDATE formation_catalogue_versions SET content_revision = content_revision + 1 WHERE id = OLD.version_id;
END;

CREATE TRIGGER IF NOT EXISTS formation_fee_lines_revision_insert AFTER INSERT ON formation_fee_lines
BEGIN
  UPDATE formation_catalogue_versions SET content_revision = content_revision + 1 WHERE id = NEW.version_id;
END;

CREATE TRIGGER IF NOT EXISTS formation_fee_lines_revision_update AFTER UPDATE ON formation_fee_lines
BEGIN
  UPDATE formation_catalogue_versions SET content_revision = content_revision + 1 WHERE id IN (OLD.version_id, NEW.version_id);
END;

CREATE TRIGGER IF NOT EXISTS formation_fee_lines_revision_delete AFTER DELETE ON formation_fee_lines
BEGIN
  UPDATE formation_catalogue_versions SET content_revision = content_revision + 1 WHERE id = OLD.version_id;
END;

CREATE TRIGGER IF NOT EXISTS formation_pack_items_revision_insert AFTER INSERT ON formation_pack_items
BEGIN
  UPDATE formation_catalogue_versions SET content_revision = content_revision + 1 WHERE id = NEW.version_id;
END;

CREATE TRIGGER IF NOT EXISTS formation_pack_items_revision_update AFTER UPDATE ON formation_pack_items
BEGIN
  UPDATE formation_catalogue_versions SET content_revision = content_revision + 1 WHERE id IN (OLD.version_id, NEW.version_id);
END;

CREATE TRIGGER IF NOT EXISTS formation_pack_items_revision_delete AFTER DELETE ON formation_pack_items
BEGIN
  UPDATE formation_catalogue_versions SET content_revision = content_revision + 1 WHERE id = OLD.version_id;
END;

CREATE TRIGGER IF NOT EXISTS formation_fact_schema_revision_insert AFTER INSERT ON formation_fact_schema
BEGIN
  UPDATE formation_catalogue_versions SET content_revision = content_revision + 1 WHERE id = NEW.version_id;
END;

CREATE TRIGGER IF NOT EXISTS formation_fact_schema_revision_update AFTER UPDATE ON formation_fact_schema
BEGIN
  UPDATE formation_catalogue_versions SET content_revision = content_revision + 1 WHERE id IN (OLD.version_id, NEW.version_id);
END;

CREATE TRIGGER IF NOT EXISTS formation_fact_schema_revision_delete AFTER DELETE ON formation_fact_schema
BEGIN
  UPDATE formation_catalogue_versions SET content_revision = content_revision + 1 WHERE id = OLD.version_id;
END;

CREATE TRIGGER IF NOT EXISTS formation_scenarios_revision_insert AFTER INSERT ON formation_scenarios
BEGIN
  UPDATE formation_catalogue_versions SET content_revision = content_revision + 1 WHERE id = NEW.version_id;
END;

CREATE TRIGGER IF NOT EXISTS formation_scenarios_revision_update AFTER UPDATE ON formation_scenarios
BEGIN
  UPDATE formation_catalogue_versions SET content_revision = content_revision + 1 WHERE id IN (OLD.version_id, NEW.version_id);
END;

CREATE TRIGGER IF NOT EXISTS formation_scenarios_revision_delete AFTER DELETE ON formation_scenarios
BEGIN
  UPDATE formation_catalogue_versions SET content_revision = content_revision + 1 WHERE id = OLD.version_id;
END;

CREATE TRIGGER IF NOT EXISTS formation_rules_revision_insert AFTER INSERT ON formation_rules
BEGIN
  UPDATE formation_catalogue_versions SET content_revision = content_revision + 1 WHERE id = NEW.version_id;
END;

CREATE TRIGGER IF NOT EXISTS formation_rules_revision_update AFTER UPDATE ON formation_rules
BEGIN
  UPDATE formation_catalogue_versions SET content_revision = content_revision + 1 WHERE id IN (OLD.version_id, NEW.version_id);
END;

CREATE TRIGGER IF NOT EXISTS formation_rules_revision_delete AFTER DELETE ON formation_rules
BEGIN
  UPDATE formation_catalogue_versions SET content_revision = content_revision + 1 WHERE id = OLD.version_id;
END;
