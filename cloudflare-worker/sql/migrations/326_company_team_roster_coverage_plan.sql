-- 326_company_team_roster_coverage_plan.sql — the founder's Team page: the
-- roster, function coverage and the headcount plan (D435, wave 8, Session 15,
-- item 6).
--
-- The integrated Team canvas draws, per company, who builds it: each person's
-- type, start date, access, compensation, equity grant and vesting schedule,
-- and the state of their paperwork; which functions are covered, thin or a
-- gap; and a headcount plan the roster is measured against. None of it had a
-- store. `user_company_links` (migration 191) records only accounts that have
-- joined the workspace — an offer out, a contractor with no login, an advisor
-- on a cadence are not links — and `cap_table_holders` (migration 020) is a
-- Carta-shaped import keyed by project, not a record of employment.
--
--   company_people — one row per person on a company's team, whether or not
--     they hold an account. `user_id` links the row to an account when one
--     exists; nothing derives from the link. `person_type` is founder,
--     employee, contractor or advisor. Compensation is `salary_cents`, an
--     annual integer (scripts/check-money-cents.mjs). Equity is a share count
--     and a kind (common, options, advisory, none): the grant as the company
--     recorded it, which the cap table may or may not reflect yet — the two
--     are allowed to differ and the page says which it is reading. Vesting is
--     a start date, a cliff and a length in months, from which a fraction is
--     computed on the page and labelled as computed. Paperwork is three
--     states — the agreement, the IP assignment, the 83(b) election — each
--     NULL until recorded, because "not recorded" and "missing" are different
--     facts about a diligence blocker.
--   company_function_coverage — one row per (company, function): covered,
--     thin or gap, who holds it, and what would fix it.
--   company_headcount_plan — one row per (company, period): the target the
--     roster's active count is measured against.
--
-- Every write records its actor (`created_by`, `updated_by`): a roster is a
-- record about other people, and a row nobody signed is a rumour.
--
-- STANDS ALONE and idempotent. Apply through the ledger-driven runner:
--
--   npm run d1:migrate:remote

CREATE TABLE IF NOT EXISTS company_people (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT UNIQUE NOT NULL,
  company_id INTEGER NOT NULL REFERENCES company_profiles(id),
  user_id INTEGER REFERENCES users(id),
  name TEXT NOT NULL,
  email TEXT,
  person_type TEXT NOT NULL DEFAULT 'employee',
  role_title TEXT,
  start_date TEXT,
  access_level TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  salary_cents INTEGER,
  compensation_note TEXT,
  equity_shares REAL,
  equity_kind TEXT,
  vest_start_date TEXT,
  cliff_months INTEGER,
  vest_months INTEGER,
  agreement_status TEXT,
  ip_assignment TEXT,
  election_83b TEXT,
  advisor_focus TEXT,
  advisor_cadence TEXT,
  note TEXT,
  offboarded_at TEXT,
  created_by INTEGER NOT NULL REFERENCES users(id),
  updated_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_company_people_company ON company_people(company_id, status);
CREATE INDEX IF NOT EXISTS idx_company_people_user ON company_people(user_id);

CREATE TABLE IF NOT EXISTS company_function_coverage (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT UNIQUE NOT NULL,
  company_id INTEGER NOT NULL REFERENCES company_profiles(id),
  function_name TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'gap',
  owner_note TEXT,
  fix_note TEXT,
  updated_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (company_id, function_name)
);

CREATE TABLE IF NOT EXISTS company_headcount_plan (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT UNIQUE NOT NULL,
  company_id INTEGER NOT NULL REFERENCES company_profiles(id),
  period_label TEXT NOT NULL,
  target_headcount INTEGER NOT NULL,
  note TEXT,
  updated_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (company_id, period_label)
);
