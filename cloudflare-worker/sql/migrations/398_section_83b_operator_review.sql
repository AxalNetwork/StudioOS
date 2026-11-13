-- 398 — 83(b) operator review: who operates a startup's 83(b) filing, and each
-- review of its filing record (D580, #1207; the owner's answers 1A, 2A, 3A).
--
--   1A  The operator is an Axal admin, assigned per startup (`projects.id`).
--   2A  What is reviewed is the 83(b) filing record: the item is always
--       'section_83b_filing_record'. The CHECK keeps it that way until a
--       decision adds another item.
--   3A  A review does not gate graduation. Nothing reads these tables to
--       decide a Lab milestone.
--
-- Operator review is a check that the filing record is complete. It is not tax
-- or legal advice.
--
-- Every row is append-only history. The current operator is the newest
-- assignment for the project; `operator_user_id` NULL is an unassignment. The
-- last review is the newest review row. Both are written only by an admin
-- (routes/admin_83b_review.ts), and every write is also recorded through
-- logAdminAction.
--
-- Rows are never updated, so neither table has an `updated_at`.
--
-- Additive and idempotent: CREATE TABLE / INDEX IF NOT EXISTS.
CREATE TABLE IF NOT EXISTS section_83b_operator_assignments (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  uid              TEXT NOT NULL UNIQUE DEFAULT (lower(hex(randomblob(16)))),
  project_id       INTEGER NOT NULL REFERENCES projects(id),
  operator_user_id INTEGER REFERENCES users(id),
  assigned_by      INTEGER NOT NULL REFERENCES users(id),
  created_at       TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_s83b_operator_assignments_project
  ON section_83b_operator_assignments (project_id, id);

CREATE TABLE IF NOT EXISTS section_83b_operator_reviews (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  uid              TEXT NOT NULL UNIQUE DEFAULT (lower(hex(randomblob(16)))),
  project_id       INTEGER NOT NULL REFERENCES projects(id),
  tracker_id       INTEGER REFERENCES section_83b_trackers(id),
  item             TEXT NOT NULL DEFAULT 'section_83b_filing_record'
                     CHECK (item = 'section_83b_filing_record'),
  operator_user_id INTEGER NOT NULL REFERENCES users(id),
  outcome          TEXT NOT NULL CHECK (outcome IN ('complete', 'incomplete')),
  note             TEXT,
  follow_up_date   TEXT CHECK (follow_up_date IS NULL
                     OR follow_up_date GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]'),
  reviewed_by      INTEGER NOT NULL REFERENCES users(id),
  created_at       TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_s83b_operator_reviews_project
  ON section_83b_operator_reviews (project_id, id);
