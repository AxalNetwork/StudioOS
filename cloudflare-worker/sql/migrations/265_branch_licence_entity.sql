-- 265 — the five fields `MyLicencePage` reads and the copy never carried.
--
-- WHAT WENT WRONG, stated rather than quietly patched, and it is the same
-- failure 257 corrected one field at a time. `branch_licence` (256) is the
-- local copy of HQ's `territory_licences` row, and the page it exists to
-- render — `/admin/my-licence`, the subsidiary administrator's only view of
-- their own terms — reads five fields the copy has never stored:
--
--   registered_address · signatory_name · signatory_title  → the Entity panel
--   term_years                                             → Commercial terms
--   terminated_at                                          → Dates
--
-- So on a branch the Entity panel prints "Not recorded" four times over about
-- a licence whose entity and signatory HQ knows perfectly well, and a
-- terminated licence never shows when it ended. Every one of those is a
-- statement about the business that nothing measured.
--
-- THE TYPES ARE HQ'S. `LicenceRow` (routes/admin_licences.ts) holds
-- `term_years` as an INTEGER count of years and the other four as TEXT;
-- 256's header already states the rule this follows — "the push is a
-- column-for-column write with no arithmetic in it" — because a copy that
-- converts is a copy that loses.
--
-- WHY A NEW MIGRATION RATHER THAN A CORRECTION TO 256, in 257's own words,
-- which apply here unchanged: 256 is applied, it is in `main` and in the
-- ledger of every database that has run migrations since, and editing an
-- applied migration changes what a FRESH build produces without changing any
-- existing database — which is how two databases claiming the same schema
-- version come to have different schemas. The rule is additive-only, and it
-- holds even though `branch_licence` is empty in every database that exists,
-- because the rule is what makes that emptiness something we can stop having
-- to check.
--
-- NULLABLE, WITH NO DEFAULTS, for 257's reason as well: a branch whose licence
-- HQ pushed before these columns existed has nothing to backfill from. The
-- values are HQ's, and inventing one here would be the copy asserting
-- something HQ never said. The page reads a missing field the way it reads
-- every other absent one.
--
-- NOT ADDED: a column for `term_end`. 256 stores one and HQ has no such fact —
-- it holds a DURATION (`term_years`) beside `starts_on`. The column stays
-- where it is, written and unread, because dropping a written column is not
-- additive; what changes is that the payload stops offering it as though the
-- page wanted it.

ALTER TABLE branch_licence ADD COLUMN registered_address TEXT;
ALTER TABLE branch_licence ADD COLUMN signatory_name TEXT;
ALTER TABLE branch_licence ADD COLUMN signatory_title TEXT;
ALTER TABLE branch_licence ADD COLUMN term_years INTEGER;
ALTER TABLE branch_licence ADD COLUMN terminated_at TEXT;
