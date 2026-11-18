-- D6315: accepted Grow destinations and edit-safe undo, without copying source content.
CREATE TABLE grow_proposal_receipts (
 uid TEXT PRIMARY KEY,
 project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
 source TEXT NOT NULL CHECK(source IN ('mercury','google','posthog','beehiiv')),
 source_id INTEGER NOT NULL,
 target_kind TEXT NOT NULL CHECK(target_kind IN ('partner','obligation','feedback','channel')),
 target_id INTEGER NOT NULL,
 target_uid TEXT NOT NULL,
 target_version INTEGER NOT NULL,
 created_record INTEGER NOT NULL CHECK(created_record IN (0,1)),
 accepted_by INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 state TEXT NOT NULL DEFAULT 'accepted' CHECK(state IN ('accepted','undoing','undone')),
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 undone_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
 undone_at TEXT
);
CREATE INDEX grow_proposal_receipts_project ON grow_proposal_receipts(project_id,source,accepted_by,state);
ALTER TABLE growth_partners ADD COLUMN grow_undo_version INTEGER NOT NULL DEFAULT 0;
-- Count every update, including a same-second edit followed by an edit back.
CREATE TRIGGER growth_partners_grow_undo_revision AFTER UPDATE ON growth_partners
WHEN NEW.grow_undo_version=OLD.grow_undo_version
BEGIN
 UPDATE growth_partners SET grow_undo_version=OLD.grow_undo_version+1 WHERE id=NEW.id;
END;
ALTER TABLE compliance_events ADD COLUMN grow_undo_version INTEGER NOT NULL DEFAULT 0;
-- Count every update, including a same-second edit followed by an edit back.
CREATE TRIGGER compliance_events_grow_undo_revision AFTER UPDATE ON compliance_events
WHEN NEW.grow_undo_version=OLD.grow_undo_version
BEGIN
 UPDATE compliance_events SET grow_undo_version=OLD.grow_undo_version+1 WHERE id=NEW.id;
END;
ALTER TABLE product_feedback ADD COLUMN grow_undo_version INTEGER NOT NULL DEFAULT 0;
-- Count every update, including a same-second edit followed by an edit back.
CREATE TRIGGER product_feedback_grow_undo_revision AFTER UPDATE ON product_feedback
WHEN NEW.grow_undo_version=OLD.grow_undo_version
BEGIN
 UPDATE product_feedback SET grow_undo_version=OLD.grow_undo_version+1 WHERE id=NEW.id;
END;
ALTER TABLE growth_channels ADD COLUMN grow_undo_version INTEGER NOT NULL DEFAULT 0;
-- Count every update, including a same-second edit followed by an edit back.
CREATE TRIGGER growth_channels_grow_undo_revision AFTER UPDATE ON growth_channels
WHEN NEW.grow_undo_version=OLD.grow_undo_version
BEGIN
 UPDATE growth_channels SET grow_undo_version=OLD.grow_undo_version+1 WHERE id=NEW.id;
END;
