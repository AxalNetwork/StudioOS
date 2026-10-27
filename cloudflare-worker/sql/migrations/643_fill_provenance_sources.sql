-- 643 — Fill with Eadwyn part 2: where a filled value came from, and what it replaced (D1325, #3486, #2431).
--
-- Columns only, no new table and no data change. THESE NAMES ARE THE CONTRACT
-- (#2431 § Stores and routes): PIPE-BUILD (#2426) and PIPE-RAISE (#2430) write
-- them as written here.
--
--   fill_provenance
--     source_kind    'eadwyn', 'connector' or 'module'. NULL on a row from
--                    before this migration, which is Eadwyn's (every earlier
--                    writer was an Eadwyn fill).
--     source_ref     the source's own key: a connector's provider key
--                    ('github', 'mercury'), a module's '<cycle>/<slug>', or
--                    NULL for Eadwyn.
--     source_label   the Source word the mark shows: 'connector', 'document',
--                    'recorded', 'signed' or 'typed'; NULL for an Eadwyn value.
--     source_as_of   when the source's value was true (a sync's date, the
--                    record's update); NULL when the source has no date.
--     prior_value    what the field held before the fill, so it can be undone;
--                    NULL when it was blank.
--     undone_at, undone_by   set once by an undo (part 3, D1326). A row with
--                    undone_at is never read as a mark again.
--
-- `ai_rail_proposals` already has #2431's three (`source_kind`, `source_ref`,
-- `source_label`): migration 581 (D1065) added them, so this file does not.
-- `ensureRailProposalSourceColumns` still checks them for a database made
-- before 581, and `ensureFillProvenanceSchema` carries this file's DDL for one
-- made before 643 (D235).

ALTER TABLE fill_provenance ADD COLUMN source_kind TEXT;
ALTER TABLE fill_provenance ADD COLUMN source_ref TEXT;
ALTER TABLE fill_provenance ADD COLUMN source_label TEXT;
ALTER TABLE fill_provenance ADD COLUMN source_as_of TEXT;
ALTER TABLE fill_provenance ADD COLUMN prior_value TEXT;
ALTER TABLE fill_provenance ADD COLUMN undone_at TEXT;
ALTER TABLE fill_provenance ADD COLUMN undone_by INTEGER;
