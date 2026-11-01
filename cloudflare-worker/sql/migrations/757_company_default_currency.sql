-- 757 — a company's default currency (#3932; #3696 Q4, the owner's answer of
-- 2026-11-01: Company › General keeps "Default currency" as a real field).
-- Number taken on #3932 by S24, 2026-11-01: 755 and 756 are on main and no
-- open pull request uses 757.
--
-- company_profiles.default_currency: an ISO 4217 code ('USD', 'EUR'), checked
-- against the list in services/currencies.ts by PATCH /api/company/:uid.
-- Nullable and not backfilled: an unset currency reads "Not recorded", never
-- "USD".
--
-- company_membership_events.kind gains 'currency_change', so the change is
-- recorded in the company's own event log beside 'rename' and 'archive', in
-- the same batch as the update.
--
-- SQLite cannot widen a CHECK in place, so company_membership_events is
-- rebuilt with 597's columns, defaults, keys and CHECKs, and every row is
-- copied with its id. No row changes and none is added. Its two indexes are
-- created again on the new table. It has no foreign key into it and no
-- trigger on it (grep: only 597 creates it; services/companyMembershipEvents.ts,
-- services/projectMove.ts and services/incorporationCompany.ts write it).
--
-- No BEGIN/COMMIT: D1 applies a migration file as one batch.

ALTER TABLE company_profiles ADD COLUMN default_currency TEXT;

CREATE TABLE company_membership_events_v757 (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id     INTEGER REFERENCES company_profiles(id) ON DELETE CASCADE,
  project_id     INTEGER REFERENCES projects(id) ON DELETE CASCADE,
  actor_user_id  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  target_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  kind           TEXT NOT NULL CHECK (kind IN (
                   'join', 'role_change', 'remove', 'leave', 'transfer', 'archive', 'restore', 'rename',
                   'project_move', 'project_transfer', 'seat_add', 'seat_remove', 'currency_change')),
  before_json    TEXT,
  after_json     TEXT,
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (company_id IS NOT NULL OR project_id IS NOT NULL)
);

INSERT INTO company_membership_events_v757
  (id, company_id, project_id, actor_user_id, target_user_id, kind, before_json, after_json, created_at)
  SELECT id, company_id, project_id, actor_user_id, target_user_id, kind, before_json, after_json, created_at
  FROM company_membership_events;

DROP TABLE company_membership_events;

ALTER TABLE company_membership_events_v757 RENAME TO company_membership_events;

CREATE INDEX IF NOT EXISTS idx_company_membership_events_company ON company_membership_events(company_id, created_at);
CREATE INDEX IF NOT EXISTS idx_company_membership_events_project ON company_membership_events(project_id, created_at);
