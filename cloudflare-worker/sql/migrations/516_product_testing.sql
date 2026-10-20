-- 516 — product testing (D812, #2258).
--
-- HQ and partners run programmes that recruit members to test a product. A
-- partner's programme goes draft → submitted → approved (HQ) → open (HQ) →
-- closed; HQ's own programmes skip the review and open from draft. HQ can send
-- a partner's back (`rejected`, with `review_note`); the partner's next edit
-- returns it to draft. `testing` is reserved for the period between applications
-- closing and testing ending (D814, D815); close accepts it.
--
-- A member applies once per programme (UNIQUE). The owner picks or declines;
-- picks never exceed `places`. `consent_email_at` is the member's agreement to
-- be emailed about this programme, with the version of the sentence they read.
-- Mail's testers list is the picked applications that carry it (D811).
--
-- `testing_events` is append-only: every change writes one row, who and what.
--
-- Additive and idempotent.
CREATE TABLE IF NOT EXISTS testing_programmes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  owner_kind TEXT NOT NULL CHECK (owner_kind IN ('hq', 'partner')),
  -- The partner firm (`partners.id`) for a partner's programme, NULL for HQ's.
  owner_partner_id INTEGER REFERENCES partners(id),
  -- Who created it: the partner user who is told when HQ approves or sends it back.
  created_by INTEGER NOT NULL REFERENCES users(id),
  product_name TEXT NOT NULL,
  logo_key TEXT,
  summary TEXT,
  tester_tasks TEXT,
  time_needed TEXT,
  opens_at TEXT,
  closes_at TEXT,
  testing_starts TEXT,
  testing_ends TEXT,
  places INTEGER NOT NULL CHECK (places > 0),
  eligible_roles TEXT NOT NULL DEFAULT '[]',
  questions TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'submitted', 'approved', 'open', 'testing', 'closed', 'rejected')),
  review_note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK ((owner_kind = 'hq' AND owner_partner_id IS NULL) OR (owner_kind = 'partner' AND owner_partner_id IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS idx_testing_programmes_status ON testing_programmes(status);
CREATE INDEX IF NOT EXISTS idx_testing_programmes_partner ON testing_programmes(owner_partner_id);

CREATE TABLE IF NOT EXISTS testing_applications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  programme_id INTEGER NOT NULL REFERENCES testing_programmes(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  answers TEXT NOT NULL DEFAULT '[]',
  availability TEXT,
  consent_email_at TEXT,
  consent_version TEXT,
  status TEXT NOT NULL DEFAULT 'applied' CHECK (status IN ('applied', 'picked', 'declined', 'withdrawn')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (programme_id, user_id),
  CHECK (consent_email_at IS NULL OR consent_version IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_testing_applications_user ON testing_applications(user_id);
CREATE INDEX IF NOT EXISTS idx_testing_applications_programme ON testing_applications(programme_id, status);

CREATE TABLE IF NOT EXISTS testing_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  programme_id INTEGER NOT NULL,
  application_id INTEGER,
  actor_user_id INTEGER,
  action TEXT NOT NULL,
  detail TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_testing_events_programme ON testing_events(programme_id, id);

CREATE TRIGGER IF NOT EXISTS testing_events_no_update
BEFORE UPDATE ON testing_events
BEGIN
  SELECT RAISE(ABORT, 'testing_events is append-only (D812).');
END;

CREATE TRIGGER IF NOT EXISTS testing_events_no_delete
BEFORE DELETE ON testing_events
BEGIN
  SELECT RAISE(ABORT, 'testing_events is append-only (D812).');
END;
