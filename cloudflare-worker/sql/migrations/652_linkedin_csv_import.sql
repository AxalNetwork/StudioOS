-- 652 — LinkedIn part 2: the member's contact import from Connections.csv
-- (D1351, #3566, part 2 of #3564). The number is the issue's.
--
-- Grep first (D689 D-t):
--   · `network_connections` (057) is the member's own book and has no profile
--     URL or connected date, so two columns are added to it.
--   · `contact_tasks` (127) hangs off `contacts`, the founder's inbound CRM,
--     and its only owner is `created_by`; it cannot hold a task on a row of
--     the book. So the book's notes and follow-ups get their own two tables,
--     each bound to the book row's owner.
--   · No table records a suggested duplicate, so `contact_match_reviews` is
--     new.
--
-- EVERY ROW HERE IS ONE MEMBER'S. Each table carries `owner_user_id`, and
-- every read and write binds it; nothing is matched across members.

ALTER TABLE network_connections ADD COLUMN linkedin_url TEXT;
ALTER TABLE network_connections ADD COLUMN connected_on TEXT;
CREATE INDEX IF NOT EXISTS idx_network_conn_user_linkedin ON network_connections(user_id, linkedin_url);
CREATE INDEX IF NOT EXISTS idx_network_conn_user_email ON network_connections(user_id, email);

-- A suggested duplicate: an imported row of the book and one of the member's
-- own records it may be the same person as. Only the member decides:
--   merged     — the two book rows became one; both provenance rows stay;
--   kept_both  — the same person, kept as two rows;
--   dismissed  — not the same person.
-- `candidate_table` is the member's own record the import matched: another
-- row of their book, a raise prospect, a job applicant, an interviewee or a
-- partner's book contact. Merge is offered only between two rows of the book.
CREATE TABLE IF NOT EXISTS contact_match_reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  owner_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  job_id INTEGER REFERENCES contact_import_jobs(id) ON DELETE SET NULL,
  contact_id INTEGER NOT NULL,
  candidate_table TEXT NOT NULL CHECK (candidate_table IN ('network_connections', 'raise_prospects', 'job_applications', 'discovery_interviews', 'partner_book_contacts')),
  candidate_id INTEGER NOT NULL,
  reason TEXT NOT NULL CHECK (reason IN ('url', 'email', 'name_company')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'merged', 'kept_both', 'dismissed')),
  decided_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (owner_user_id, contact_id, candidate_table, candidate_id)
);
CREATE INDEX IF NOT EXISTS idx_contact_match_reviews_owner ON contact_match_reviews(owner_user_id, status, created_at);

-- Notes and follow-ups on a row of the member's book.
CREATE TABLE IF NOT EXISTS network_contact_notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  owner_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  contact_id INTEGER NOT NULL REFERENCES network_connections(id) ON DELETE CASCADE,
  body TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 4000),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_network_contact_notes ON network_contact_notes(owner_user_id, contact_id, created_at);

CREATE TABLE IF NOT EXISTS network_contact_tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  owner_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  contact_id INTEGER NOT NULL REFERENCES network_connections(id) ON DELETE CASCADE,
  title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 300),
  due_on TEXT,
  done_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_network_contact_tasks ON network_contact_tasks(owner_user_id, contact_id, done_at);
