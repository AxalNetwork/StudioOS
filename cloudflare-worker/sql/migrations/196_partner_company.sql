-- 196 — the partner's agency, on the rows that agency owns.
--
-- Company scoping, stage 8. The Partner sidebar carries three rows that show a
-- partner's own work: Pipeline (their quotes on founder needs), Delivery
-- (their engagements) and Offers (their service catalogue and co-marketing
-- pitches). Each is keyed on the partner alone, so none of them can say which
-- of that person's agencies the row belongs to.
--
-- WHY NOT A COLUMN ON `partners`. Putting `company_id` on the partner PROFILE
-- would give each partner exactly one agency forever: a partner with two would
-- need two profile rows, and every row they already own would follow whichever
-- profile they were signed in as. The company has to sit on the DATA, the same
-- way 189 put it on projects and 193-195 put it on the investor's
-- relationships, or switching agencies cannot move anything.
--
-- THE ID BRIDGE, and it is not the one 193-195 used. Those tables key on
-- `users(id)` directly. `quotes`, `engagements` and `comarketing_pitches` key
-- on `partners(id)`, reached from an account through `users.partner_id` —
-- exactly the shape 189 had to bridge for `founders(id)`. So the backfill
-- hops partners -> users -> user_company_links. `service_offerings` was the
-- exception: it keys on `owner_user_id`, a plain `users(id)`, and needed no
-- bridge. Only the bridged form survives — see the correction note below for
-- why the direct one could not be written at all.
--
-- WHAT DELIBERATELY GETS NO COLUMN.
--
--   * `founder_needs` — the demand board a partner browses. A partner is meant
--     to see needs from founders they have no relationship with; that is the
--     entire surface. It is a marketplace, and the same rule stage 6 applied
--     to the deal list applies here. The founder's OWN view of their needs
--     narrows, but transitively through `founder_needs.project_id` and
--     migration 189, so it needs nothing from this file.
--
--   * `service_offerings` read WITHOUT `?mine=1` — the founder-facing catalog.
--     Same reason. The column added below narrows only the owner's view of
--     their own catalog (`?mine=1`) and the write gate.
--
-- TWO-SIDED ROWS. `engagements` and `quotes` each join a founder to a partner,
-- so "which company is this row in" has two answers depending on who is
-- asking. The founder's answer already exists — both reach a project, and 189
-- put `company_id` there — so `company_id` here means THE PARTNER'S AGENCY and
-- nothing else. The founder branch of those handlers narrows through the
-- project, exactly as the founder branch of the deals list does.
--
-- BACKFILL: mirrors 189 and 193-195 for the two tables that can carry one. A
-- row lands in its owner's PRIMARY company (`user_company_links.is_primary_admin
-- = 1`, oldest link first), and an owner with no primary company keeps NULL —
-- which every scope in this rollout reads as "visible under every company".
-- Nothing is invented. `quotes` and `service_offerings` keep NULL for every
-- row; the correction note below says why, and it costs nothing today.

-- CORRECTED IN PLACE, 2026-09-02, after this file failed its first production
-- run. The original version indexed and backfilled `quotes` on `partner_id` and
-- `service_offerings` on `owner_user_id`, and those two columns come from
-- OPPOSITE lineages of two multiply-defined tables:
--
--     quotes.partner_id        only in sql/t13_t14_t15.sql
--     quotes.provider_user_id  only in sql/schema.sql + migration 034
--     service_offerings.owner_user_id   only in sql/schema.sql + migration 034
--     service_offerings.partner_id      only in sql/t13_t14_t15.sql
--
-- D1 holds one table per name and every one of those definitions is
-- `CREATE TABLE IF NOT EXISTS`, so the first file to run won and the rest were
-- no-ops. No ordering of them produces a database where BOTH columns exist —
-- so this migration could not apply to any real database. It did not: the
-- production run failed and D1 rolled the whole file back, which is the only
-- reason the schema is not now half-migrated.
--
-- Editing rather than superseding is deliberate and safe. The runner
-- (`scripts/migrate-d1.mjs`) is forward-only and keys on filename: 196 is in no
-- ledger, so the corrected file applies fresh where it is pending, and where it
-- somehow did apply it is never re-run — the checksum drift is a warning, not a
-- replay. `scripts/check-migration-column-shapes.mjs` now fails the build on
-- this class, and it flags exactly the two reads below and nothing else across
-- all 199 migrations.
--
-- WHAT CHANGED. Both ambiguous tables keep their column and get an index on
-- `company_id` ALONE — an ALTER-added column is present whichever definition
-- won, so indexing it is safe either way. Their BACKFILLS are dropped, because
-- a backfill has to name the owner and no owner column is common to both
-- shapes. `engagements` and `comarketing_pitches` have one definition each
-- (`t13_t14_t15.sql`, proven applied to production by migration 183's
-- `ALTER TABLE comarketing_pitches`), so they keep both index and backfill.
--
-- DROPPING THOSE TWO BACKFILLS COSTS NOTHING TODAY, and this is the whole
-- reason it is an acceptable fix rather than a retreat. `company_id IS NULL`
-- already means "visible under every company" on both read paths —
-- `routes/services.ts:72` and `routes/needs.ts:323` both spell it
-- `(company_id = ? OR company_id IS NULL)`. So an un-backfilled row keeps
-- EXACTLY its pre-migration visibility, and every row written from here on is
-- scoped at INSERT (`services.ts:115`, `needs.ts:265`). Nothing is invented and
-- nothing narrows wrongly; only history stays unscoped.
--
-- TO FINISH THE JOB, someone has to settle which shape production actually
-- holds — the repository cannot say:
--
--     npx wrangler d1 execute studioos-db --remote \
--       --command="PRAGMA table_info('quotes')"
--     npx wrangler d1 execute studioos-db --remote \
--       --command="PRAGMA table_info('service_offerings')"
--
-- Then a follow-up migration backfills the two tables against the real columns
-- and records the answer in `scripts/sqlite-table-collisions-baseline.json`,
-- which is where the `service_offerings` half of this is already written down.
-- Note that whichever way it went, ONE of `routes/services.ts` and
-- `routes/needs.ts` is querying a column the live table does not have — that is
-- a live bug this migration merely stopped tripping over, not one it fixes.

ALTER TABLE quotes ADD COLUMN company_id INTEGER;
ALTER TABLE engagements ADD COLUMN company_id INTEGER;
ALTER TABLE comarketing_pitches ADD COLUMN company_id INTEGER;
ALTER TABLE service_offerings ADD COLUMN company_id INTEGER;

-- `company_id` alone on the two ambiguous tables: it is ALTER-added above, so
-- it exists whichever definition won. `engagements` and `comarketing_pitches`
-- have a single definition, so their owner column is safe to lead with.
CREATE INDEX IF NOT EXISTS idx_quotes_company ON quotes(company_id);
CREATE INDEX IF NOT EXISTS idx_engagements_company ON engagements(partner_id, company_id);
CREATE INDEX IF NOT EXISTS idx_comktg_pitches_company ON comarketing_pitches(partner_id, company_id);
CREATE INDEX IF NOT EXISTS idx_offerings_company ON service_offerings(company_id);

-- The bridged form: partners(id) -> users.partner_id -> user_company_links.
--
-- `quotes` is NOT backfilled here: its owner column is `partner_id` in the t13
-- shape and `provider_user_id` in the schema.sql shape, and naming either one
-- is what made this file unapplicable. Its rows stay NULL — visible under every
-- company, exactly as they were before this migration.
UPDATE engagements
   SET company_id = (
     SELECT ucl.company_id
       FROM users u
       JOIN user_company_links ucl ON ucl.user_id = u.id
      WHERE u.partner_id = engagements.partner_id
        AND ucl.is_primary_admin = 1
      ORDER BY ucl.created_at ASC LIMIT 1
   )
 WHERE company_id IS NULL;

UPDATE comarketing_pitches
   SET company_id = (
     SELECT ucl.company_id
       FROM users u
       JOIN user_company_links ucl ON ucl.user_id = u.id
      WHERE u.partner_id = comarketing_pitches.partner_id
        AND ucl.is_primary_admin = 1
      ORDER BY ucl.created_at ASC LIMIT 1
   )
 WHERE company_id IS NULL;

-- `service_offerings` is not backfilled either, for the mirror-image reason:
-- its owner is `owner_user_id` in the schema.sql shape and `partner_id` in the
-- t13 shape. Same NULL semantics, same deferral.
