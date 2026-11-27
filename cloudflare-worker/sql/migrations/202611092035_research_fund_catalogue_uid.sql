-- D4613 (#4613): one catalogue fund is one row on a member's shortlist.
--
-- "Add to my funds" from the public fund directory used to INSERT a fresh row
-- on every request, so a double click or a retried request after a dropped
-- response left two rows for one fund. The row now records which directory
-- fund it came from, and the unique index below makes a repeat of the same
-- add answer with the row already there.
--
-- A fund the member types in by hand has no catalogue uid (NULL), and the
-- index is partial, so any number of hand-written rows stay possible, even
-- two with the same name: a deliberate second entry is the member's call.
-- Rows written before this migration keep NULL; nothing is backfilled, so no
-- existing row can collide with the index.

ALTER TABLE research_funds ADD COLUMN catalogue_uid TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS uq_research_funds_owner_catalogue
    ON research_funds (owner_user_id, catalogue_uid)
    WHERE catalogue_uid IS NOT NULL;
