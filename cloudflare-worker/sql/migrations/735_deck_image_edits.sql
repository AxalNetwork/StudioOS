-- 735 — D1544 (#3784, deck builder v2 B8): an image edit is a child image.
-- Number given on #3784 by S1.
--
--   deck_images.parent_uid  the image this one was made from by an edit
--                           (vary, edit, erase, expand), or NULL for a drawn
--                           or uploaded image. Reverting an edit discards the
--                           child and answers the parent, whose row is never
--                           changed by an edit.
--   deck_images.edit_op     which edit made it, or NULL: exactly when
--                           parent_uid is set (the route writes both together;
--                           SQLite cannot add a table CHECK to an existing
--                           table, so the pairing is the route's and the
--                           test's).
--
-- Grep first (D689 D-t): neither column exists on deck_images in
-- schema_baseline.sql or any migration (543, 714, 718).
--
-- Additive: two ADD COLUMNs and an index. NON-IDEMPOTENT (D1's ALTER TABLE
-- has no IF NOT EXISTS): the ledger runner applies it once.

ALTER TABLE deck_images ADD COLUMN parent_uid TEXT CHECK (parent_uid IS NULL OR length(parent_uid) = 36);
ALTER TABLE deck_images ADD COLUMN edit_op TEXT CHECK (edit_op IS NULL OR edit_op IN ('vary', 'edit', 'erase', 'expand'));
CREATE INDEX IF NOT EXISTS idx_deck_images_parent ON deck_images(parent_uid) WHERE parent_uid IS NOT NULL;
