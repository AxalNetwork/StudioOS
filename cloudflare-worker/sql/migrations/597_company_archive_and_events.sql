-- 597 — archive a company, and the membership audit (D1137, #3017).
-- Reserved for D1137 on #3017 (part 3 of Companies and projects, #2422), 2026-10-25.
--
-- A company could only be left or deleted by hand, and nothing recorded who
-- joined, who changed whose role, or who moved a venture. This adds:
--
--   company_profiles.archived_at / archived_by
--     A primary admin archives a company (owner question 3 A) and restores it.
--     NULL is "not archived", which every company written before this
--     migration is. An archived company leaves `GET /api/company/memberships`
--     and `resolveActiveCompany` reads it as no company, so nothing is scoped
--     to it; its rows, members and ventures stay where they are.
--
--   company_membership_events
--     One row per change to who belongs to a company or a venture: a join,
--     a role change, a removal, a leave, a primary-admin transfer, an archive,
--     a restore, a rename, a venture moved to a company, a venture's owner
--     transferred, and a venture seat added or removed. `before_json` and
--     `after_json` hold the fields the change touched (a role, a company id, a
--     name), never a token, an email or an invitation code. A row is written
--     in the same batch as the change it records, so a change is never
--     recorded without happening or the other way round.
--
--     `company_id` is the company the change is about; a venture's event
--     names its project and, when it has one, its company. One of the two is
--     always set.
--
-- Grep first (D689 D-t): no `archived_at` on `company_profiles` and no
-- `company_membership_events` table exists in any earlier migration or the
-- baseline.
ALTER TABLE company_profiles ADD COLUMN archived_at TEXT;
ALTER TABLE company_profiles ADD COLUMN archived_by INTEGER REFERENCES users(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS company_membership_events (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id     INTEGER REFERENCES company_profiles(id) ON DELETE CASCADE,
  project_id     INTEGER REFERENCES projects(id) ON DELETE CASCADE,
  actor_user_id  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  target_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  kind           TEXT NOT NULL CHECK (kind IN (
                   'join', 'role_change', 'remove', 'leave', 'transfer', 'archive', 'restore', 'rename',
                   'project_move', 'project_transfer', 'seat_add', 'seat_remove')),
  before_json    TEXT,
  after_json     TEXT,
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (company_id IS NOT NULL OR project_id IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_company_membership_events_company ON company_membership_events(company_id, created_at);
CREATE INDEX IF NOT EXISTS idx_company_membership_events_project ON company_membership_events(project_id, created_at);
