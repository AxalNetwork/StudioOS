-- D5157 part 3 (#5157) — a Research Project's companies and funds, and its
-- comparisons (canvas `design/incoming/Research v2 Page.dc.html`, board RS-02
-- D · Comparisons, RS-04 A and B (Add to research, Compare 2) and RS-05 A and
-- B (Add to my research)).
--
-- A SUBJECT IS A DIRECTORY ROW THE MEMBER ADDED TO THE PROJECT. "Add to
-- research" on a company or a fund writes one `research_project_subjects` row
-- naming the company directory (migration 228) or fund directory (378) row by
-- its uid. The directories are shared catalogues that are rebuilt by import, so
-- the uid is a reference, not a foreign key: when the row leaves the directory
-- the page says so by the name kept here, and never guesses its values. The
-- name is the directory's own at the time it was added.
--
-- A COMPARISON IS A NAMED SET OF ONE KIND. Its members are subjects of the
-- same project and the same kind, so every column of the table has the same
-- attributes. The kind is held on both sides of each member's two composite
-- foreign keys, so a fund can never be put in a company comparison, even by a
-- statement that skips the route. Removing a subject from the project removes
-- it from its comparisons (CASCADE); deleting a comparison leaves its subjects.
--
-- NOTHING IS COPIED FROM THE DIRECTORY BUT THE NAME. Every value a comparison
-- shows is read from the directory when the page is read, with its source and
-- as-of date, so a comparison never keeps a stale figure and never scores.
--
-- No transaction statements: D1 rejects them (scripts/check-sql-migrations.mjs).

CREATE TABLE IF NOT EXISTS research_project_subjects (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id     INTEGER NOT NULL REFERENCES research_projects(id) ON DELETE CASCADE,
  owner_user_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind           TEXT NOT NULL CHECK (kind IN ('company', 'fund')),
  directory_uid  TEXT NOT NULL CHECK (length(directory_uid) BETWEEN 1 AND 64),
  name           TEXT NOT NULL CHECK (length(trim(name)) >= 1),
  created_by     INTEGER NOT NULL REFERENCES users(id),
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (project_id, kind, directory_uid),
  -- The parent key of a member's (subject_id, kind) foreign key.
  UNIQUE (id, kind)
);

CREATE TABLE IF NOT EXISTS research_project_comparisons (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  uid            TEXT NOT NULL UNIQUE,
  project_id     INTEGER NOT NULL REFERENCES research_projects(id) ON DELETE CASCADE,
  owner_user_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind           TEXT NOT NULL CHECK (kind IN ('company', 'fund')),
  title          TEXT NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 160),
  created_by     INTEGER NOT NULL REFERENCES users(id),
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT NOT NULL DEFAULT (datetime('now')),
  -- The parent key of a member's (comparison_id, kind) foreign key.
  UNIQUE (id, kind)
);

CREATE INDEX IF NOT EXISTS idx_research_project_comparisons_project
  ON research_project_comparisons(project_id, id);

CREATE TABLE IF NOT EXISTS research_project_comparison_members (
  comparison_id  INTEGER NOT NULL,
  subject_id     INTEGER NOT NULL,
  kind           TEXT NOT NULL CHECK (kind IN ('company', 'fund')),
  position       INTEGER NOT NULL CHECK (position >= 1),
  created_by     INTEGER NOT NULL REFERENCES users(id),
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (comparison_id, subject_id),
  FOREIGN KEY (comparison_id, kind) REFERENCES research_project_comparisons(id, kind) ON DELETE CASCADE,
  FOREIGN KEY (subject_id, kind) REFERENCES research_project_subjects(id, kind) ON DELETE CASCADE
);

-- The CASCADE from a removed subject looks its memberships up here.
CREATE INDEX IF NOT EXISTS idx_research_project_comparison_members_subject
  ON research_project_comparison_members(subject_id, kind);
