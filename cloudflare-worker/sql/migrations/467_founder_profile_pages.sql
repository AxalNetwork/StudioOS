-- 467_founder_profile_pages.sql — D702: the founder profile pages' two
-- choices.
--
-- Grep first (D-t): neither column exists in schema_baseline.sql or in any
-- migration before this one (458 and 466 were the newest on main when it was
-- written). Both are additive and nullable, with no backfill: NULL means the
-- member has not chosen, and every reader treats NULL as today's behaviour.
--
--   projects.investor_findable — "Let investors find my venture". NULL (not
--     chosen) and 1 are read as findable, so no venture's reach changes until
--     its founder flips the toggle. 0 means an investor reaches the venture
--     only through an introduction (services/investorFindable.ts).
--
--   user_settings.visibility_chosen_at — stamped by PUT /api/settings/privacy
--     whenever the body carries `visibility`. NULL means the member never chose,
--     so a stored 'network' (the column default) is read as Public, exactly as
--     the profile was served before D702. `ensureUserSettings` declares the
--     same column at runtime, so check-schema-pair-drift sees one shape.
--
-- STANDS ALONE and idempotent under the runner: additive ALTERs only, no
-- BEGIN/COMMIT.

ALTER TABLE projects ADD COLUMN investor_findable INTEGER CHECK (investor_findable IN (0, 1));
ALTER TABLE user_settings ADD COLUMN visibility_chosen_at TEXT;
