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
-- hops partners -> users -> user_company_links. `service_offerings` is the
-- exception: it keys on `owner_user_id`, a plain `users(id)`, and needs no
-- bridge. Both forms are written out below rather than unified, because the
-- difference is the thing a later reader most needs to see.
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
-- BACKFILL: mirrors 189 and 193-195. A row lands in its owner's PRIMARY
-- company (`user_company_links.is_primary_admin = 1`, oldest link first), and
-- a partner with no primary company keeps NULL — which every scope in this
-- rollout reads as "visible under every company". Nothing is invented.

-- A NOTE ON `service_offerings`, because the repo holds TWO definitions of it
-- and only one is real. `sql/t13_t14_t15.sql` declares a partner_id /
-- description / price_min-max shape that no route reads; `sql/schema.sql` and
-- `sql/migrations/034_unmounted_routes.sql` agree on the owner_user_id / summary
-- / price_usd shape that `routes/services.ts` actually queries, and that is the
-- table this ALTER lands on. It is one of the collisions
-- `check-sqlite-table-collisions` already records. The backfill below keys on
-- `owner_user_id` for that reason.

ALTER TABLE quotes ADD COLUMN company_id INTEGER;
ALTER TABLE engagements ADD COLUMN company_id INTEGER;
ALTER TABLE comarketing_pitches ADD COLUMN company_id INTEGER;
ALTER TABLE service_offerings ADD COLUMN company_id INTEGER;

CREATE INDEX IF NOT EXISTS idx_quotes_company ON quotes(partner_id, company_id);
CREATE INDEX IF NOT EXISTS idx_engagements_company ON engagements(partner_id, company_id);
CREATE INDEX IF NOT EXISTS idx_comktg_pitches_company ON comarketing_pitches(partner_id, company_id);
CREATE INDEX IF NOT EXISTS idx_offerings_company ON service_offerings(owner_user_id, company_id);

-- The bridged form: partners(id) -> users.partner_id -> user_company_links.
UPDATE quotes
   SET company_id = (
     SELECT ucl.company_id
       FROM users u
       JOIN user_company_links ucl ON ucl.user_id = u.id
      WHERE u.partner_id = quotes.partner_id
        AND ucl.is_primary_admin = 1
      ORDER BY ucl.created_at ASC LIMIT 1
   )
 WHERE company_id IS NULL;

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

-- The direct form: service_offerings.owner_user_id is already a users(id).
UPDATE service_offerings
   SET company_id = (
     SELECT ucl.company_id FROM user_company_links ucl
      WHERE ucl.user_id = service_offerings.owner_user_id
        AND ucl.is_primary_admin = 1
      ORDER BY ucl.created_at ASC LIMIT 1
   )
 WHERE company_id IS NULL;
