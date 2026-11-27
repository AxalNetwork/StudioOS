-- D4660 (#4660, finding 5): a member's edits to a draft are stored, beside the
-- text Eadwyn generated, instead of living only in the open composer.
--
-- `subject` and `body` stay what Eadwyn generated for this version: the source
-- snapshot, never rewritten. The member's own text is kept apart in the
-- `edited_*` columns, so the generated source and the human edits stay
-- distinguishable, per version. `edit_revision` counts the saves (0 = never
-- edited); a save names the revision it read, as a layout save does (D1594), so
-- a stale tab cannot overwrite a newer one. A save is a plain write: no AI run,
-- no router, no charge.
--
-- `edited_to` is the recipient as the member typed it; it is not checked as an
-- address here (a draft may be half-written), only at send.
--
-- Additive: nullable columns and one defaulted counter, on an existing table.
ALTER TABLE mail_drafts ADD COLUMN edited_to TEXT;
ALTER TABLE mail_drafts ADD COLUMN edited_subject TEXT;
ALTER TABLE mail_drafts ADD COLUMN edited_body TEXT;
ALTER TABLE mail_drafts ADD COLUMN edit_revision INTEGER NOT NULL DEFAULT 0;
ALTER TABLE mail_drafts ADD COLUMN edited_at TEXT;
