-- 202611072255 — company_profiles.profile_version, and the 'profile_update' company event (#4963).
-- Named by its UTC minute (D4106).
--
-- OPTIMISTIC CONCURRENCY. `profile_version` is a monotonic revision of the company's General profile (the fields
-- PATCH /api/company/:uid writes, and the logo). Every such write increments it in the same statement; a write that
-- names `expected_version` updates only while the stored version still equals it, so two editors working from the
-- same version cannot silently overwrite each other: the second gets a 409 with the current company. Existing rows
-- start at 1.
--
-- THE AUDIT. Every committed General change writes one 'profile_update' event beside 'rename', 'currency_change' and
-- 'logo_change', in the same batch, holding the NAMES of the changed fields and the revision before and after,
-- never their values.
--
-- SQLite cannot widen a CHECK in place, so the events table is rebuilt exactly as 202611031619 left it with one more
-- kind, every row copied with its id, and its two indexes created again. Only 597, 757 and 202611031619 touch it; no
-- foreign key points into it and no trigger is on it.
--
-- No BEGIN/COMMIT: D1 applies a migration file as one batch.

ALTER TABLE company_profiles ADD COLUMN profile_version INTEGER NOT NULL DEFAULT 1;

CREATE TABLE company_membership_events_v4963 (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id     INTEGER REFERENCES company_profiles(id) ON DELETE CASCADE,
  project_id     INTEGER REFERENCES projects(id) ON DELETE CASCADE,
  actor_user_id  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  target_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  kind           TEXT NOT NULL CHECK (kind IN (
                   'join', 'role_change', 'remove', 'leave', 'transfer', 'archive', 'restore', 'rename',
                   'project_move', 'project_transfer', 'seat_add', 'seat_remove', 'currency_change', 'logo_change',
                   'profile_update')),
  before_json    TEXT,
  after_json     TEXT,
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (company_id IS NOT NULL OR project_id IS NOT NULL)
);

INSERT INTO company_membership_events_v4963
  (id, company_id, project_id, actor_user_id, target_user_id, kind, before_json, after_json, created_at)
  SELECT id, company_id, project_id, actor_user_id, target_user_id, kind, before_json, after_json, created_at
  FROM company_membership_events;

DROP TABLE company_membership_events;

ALTER TABLE company_membership_events_v4963 RENAME TO company_membership_events;

CREATE INDEX IF NOT EXISTS idx_company_membership_events_company ON company_membership_events(company_id, created_at);
CREATE INDEX IF NOT EXISTS idx_company_membership_events_project ON company_membership_events(project_id, created_at);
