-- 189 — projects.company_id: the company dimension the switcher never had.
--
-- DECISION: a Company OWNS many Projects (1:N). The alternative considered was
-- Company ≡ Project, which would have merged `company_profiles` into `projects`
-- and made the switcher a project switcher. It was rejected because a company
-- must be able to hold several ventures, and because `user_company_links`
-- already models multi-member, multi-company membership that a 1:1 collapse
-- would throw away.
--
-- WHY THIS ONE COLUMN IS THE WHOLE MIGRATION. 85 tables carry `project_id`.
-- Adding `company_id` to each would be 85 columns, 85 backfills and 85 chances
-- to disagree. Because a project belongs to exactly one company, those tables
-- inherit the company transitively through the project they already point at.
-- `company_profiles` had no join to anything before this row — it was read by
-- one file, `routes/company.ts`, and connected to no business data at all.
--
-- NULL IS A REAL STATE, NOT A MISSING BACKFILL. A project with no company is
-- "not yet assigned", and `companyScope` shows it to its owner under every
-- company rather than hiding it. The alternative was to invent a company per
-- founder during backfill, which would have written company names nobody
-- chose into a table users edit. Fabricating a fiduciary-adjacent record to
-- avoid a NULL is the trade this repo refuses everywhere else.
--
-- SQLite/D1: ALTER TABLE ... ADD COLUMN cannot carry a REFERENCES clause with
-- a non-NULL default, and D1 does not enforce foreign keys by default anyway.
-- The relationship is documented here and enforced by the scope function.

ALTER TABLE projects ADD COLUMN company_id INTEGER;

CREATE INDEX IF NOT EXISTS idx_projects_company ON projects(company_id);

-- Backfill: a project lands in its founder's PRIMARY company.
--
-- The join is three hops because the id spaces differ, and this is the same
-- mismatch `projectOwnerScope` documents: `projects.founder_id` points at
-- `founders(id)`, NOT at `users(id)`. Matching a user id against founder_id is
-- valid SQL that silently selects an unrelated founder, so the bridge goes
-- through `users.founder_id`:
--
--   projects.founder_id → users.founder_id → user_company_links.user_id
--                                          → user_company_links.company_id
--
-- Only `is_primary_admin = 1` links are used. A founder who is a non-primary
-- member of someone else's company must not have their projects swept into it.
UPDATE projects
   SET company_id = (
     SELECT ucl.company_id
       FROM users u
       JOIN user_company_links ucl ON ucl.user_id = u.id
      WHERE u.founder_id = projects.founder_id
        AND ucl.is_primary_admin = 1
      ORDER BY ucl.created_at ASC
      LIMIT 1
   )
 WHERE company_id IS NULL
   AND founder_id IS NOT NULL;
