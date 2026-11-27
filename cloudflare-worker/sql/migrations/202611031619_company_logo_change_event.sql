-- 202611031619 — company_membership_events.kind gains 'logo_change' (#4201, #4152 G1).
-- Named by its UTC minute (D4106).
--
-- POST and DELETE /api/company/:uid/logo record the change in the company's own
-- event log, beside 'rename' and 'currency_change', in the same batch as the
-- update. The event holds what kind of logo the company had before and after
-- ('stored', 'outside' or null), never a URL or a storage key.
--
-- SQLite cannot widen a CHECK in place, so the table is rebuilt exactly as 757
-- left it (columns, defaults, keys, CHECKs) with one more kind, and every row
-- is copied with its id. No row changes and none is added. Its two indexes are
-- created again. Only 597 and 757 touch the table; it has no foreign key into
-- it and no trigger on it.
--
-- No BEGIN/COMMIT: D1 applies a migration file as one batch.

CREATE TABLE company_membership_events_v4201 (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id     INTEGER REFERENCES company_profiles(id) ON DELETE CASCADE,
  project_id     INTEGER REFERENCES projects(id) ON DELETE CASCADE,
  actor_user_id  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  target_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  kind           TEXT NOT NULL CHECK (kind IN (
                   'join', 'role_change', 'remove', 'leave', 'transfer', 'archive', 'restore', 'rename',
                   'project_move', 'project_transfer', 'seat_add', 'seat_remove', 'currency_change', 'logo_change')),
  before_json    TEXT,
  after_json     TEXT,
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (company_id IS NOT NULL OR project_id IS NOT NULL)
);

INSERT INTO company_membership_events_v4201
  (id, company_id, project_id, actor_user_id, target_user_id, kind, before_json, after_json, created_at)
  SELECT id, company_id, project_id, actor_user_id, target_user_id, kind, before_json, after_json, created_at
  FROM company_membership_events;

DROP TABLE company_membership_events;

ALTER TABLE company_membership_events_v4201 RENAME TO company_membership_events;

CREATE INDEX IF NOT EXISTS idx_company_membership_events_company ON company_membership_events(company_id, created_at);
CREATE INDEX IF NOT EXISTS idx_company_membership_events_project ON company_membership_events(project_id, created_at);
