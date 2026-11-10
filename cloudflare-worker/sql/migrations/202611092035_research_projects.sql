-- D5157 (#5157) — the Research Project: one question, kept with its evidence
-- and its Ask history (canvas `design/incoming/Research v2 Page.dc.html`,
-- boards RS-02 and RS-01's Recent research projects; D3701).
--
-- WHAT THIS SLICE STORES. The project itself (owner, title, question,
-- objective, scope, exclusions, status, timestamps) and four link tables: the
-- Library documents and collections (D549) it treats as evidence, and the Ask
-- sessions and answers it keeps. Nothing is copied: a link names a row the
-- owner already has, and deleting that row removes the link (CASCADE), never
-- the project.
--
-- WHAT IT DOES NOT. Findings (Source fact, Eadwyn interpretation, Your
-- conclusion), comparisons and the sectioned brief come with their own routes
-- in later slices of #5157, each with its own migration. A findings table here
-- would be a store with no writer.
--
-- ARCHIVE IS A STATE, NOT A DELETE. `archived_at` is set exactly when
-- `status = 'archived'` (the CHECK holds the pair together), so "archived on"
-- is never inferred from `updated_at`. Restoring returns the project to
-- `in_progress`.
--
-- No transaction statements: D1 rejects them (scripts/check-sql-migrations.mjs).

CREATE TABLE IF NOT EXISTS research_projects (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  uid            TEXT NOT NULL UNIQUE,
  owner_user_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title          TEXT NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 160),
  question       TEXT NOT NULL CHECK (length(trim(question)) BETWEEN 1 AND 1000),
  -- NULL means not written yet, which the page says; never ''.
  objective      TEXT CHECK (objective IS NULL OR length(trim(objective)) BETWEEN 1 AND 2000),
  scope          TEXT CHECK (scope IS NULL OR length(trim(scope)) BETWEEN 1 AND 1000),
  exclusions     TEXT CHECK (exclusions IS NULL OR length(trim(exclusions)) BETWEEN 1 AND 1000),
  status         TEXT NOT NULL DEFAULT 'in_progress'
                 CHECK (status IN ('in_progress', 'complete', 'archived')),
  archived_at    TEXT,
  created_by     INTEGER NOT NULL REFERENCES users(id),
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK ((status = 'archived') = (archived_at IS NOT NULL))
);

-- My Research: "my projects, by status, most recently touched first".
CREATE INDEX IF NOT EXISTS idx_research_projects_owner
  ON research_projects(owner_user_id, status, updated_at DESC);

CREATE TABLE IF NOT EXISTS research_project_documents (
  project_id   INTEGER NOT NULL REFERENCES research_projects(id) ON DELETE CASCADE,
  document_id  INTEGER NOT NULL REFERENCES research_documents(id) ON DELETE CASCADE,
  created_by   INTEGER NOT NULL REFERENCES users(id),
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (project_id, document_id)
);

CREATE TABLE IF NOT EXISTS research_project_collections (
  project_id     INTEGER NOT NULL REFERENCES research_projects(id) ON DELETE CASCADE,
  collection_id  INTEGER NOT NULL REFERENCES research_collections(id) ON DELETE CASCADE,
  created_by     INTEGER NOT NULL REFERENCES users(id),
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (project_id, collection_id)
);

CREATE TABLE IF NOT EXISTS research_project_sessions (
  project_id  INTEGER NOT NULL REFERENCES research_projects(id) ON DELETE CASCADE,
  session_id  INTEGER NOT NULL REFERENCES research_ask_sessions(id) ON DELETE CASCADE,
  created_by  INTEGER NOT NULL REFERENCES users(id),
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (project_id, session_id)
);

CREATE TABLE IF NOT EXISTS research_project_answers (
  project_id  INTEGER NOT NULL REFERENCES research_projects(id) ON DELETE CASCADE,
  answer_id   INTEGER NOT NULL REFERENCES research_ask_answers(id) ON DELETE CASCADE,
  created_by  INTEGER NOT NULL REFERENCES users(id),
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (project_id, answer_id)
);

-- The CASCADE from a deleted document, collection, session or answer looks
-- its links up by the second column.
CREATE INDEX IF NOT EXISTS idx_research_project_documents_document ON research_project_documents(document_id);
CREATE INDEX IF NOT EXISTS idx_research_project_collections_collection ON research_project_collections(collection_id);
CREATE INDEX IF NOT EXISTS idx_research_project_sessions_session ON research_project_sessions(session_id);
CREATE INDEX IF NOT EXISTS idx_research_project_answers_answer ON research_project_answers(answer_id);
