-- 500 — GitHub feeds Solution design (D782, #2114).
--
-- Three new tables, no change to an existing one.
--
--   solution_design_proposals  an architecture note GitHub proposes: an ADR
--       file, or a README or docs section headed Architecture, Design or
--       Decisions. The sync writes it `pending`; the founder accepts it (it
--       becomes a note) or dismisses it. `source_key` names the place
--       (`owner/repo:path#anchor`), one row per place per connection.
--       `fingerprint` is the SHA-256 of the section's text: a re-sync that
--       finds the same text leaves the row alone, whatever its status, so a
--       dismissed proposal does not come back; changed text puts it back to
--       `pending`. Nothing here is in `connector_fed_items` until it is
--       accepted: a proposal is judgement, not a fact (D782 rule 2).
--   solution_design_notes  what Accept writes: the proposal's title and
--       extract, citing its file. The ledger row (`module = 'solution_design'`,
--       `kind = 'design_note'`) links it, so it counts as fed.
--   solution_design_stack  the stack, as facts: one row per chosen repository
--       per project, its languages by bytes and its topics as GitHub reports
--       them. The ledger row (`kind = 'stack'`) links it; a re-sync updates it.
--
-- Repository text is untrusted: it is stored as text and drawn as text.
-- D1 REJECTS BEGIN/COMMIT, so there is no transaction.

CREATE TABLE IF NOT EXISTS solution_design_proposals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  integration_id INTEGER NOT NULL,
  project_id INTEGER NOT NULL,
  repository TEXT NOT NULL,
  path TEXT NOT NULL,
  source_key TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  title TEXT NOT NULL,
  extract TEXT,
  url TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'dismissed')),
  note_id INTEGER,
  decided_by INTEGER,
  decided_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (integration_id, project_id, source_key)
);

CREATE INDEX IF NOT EXISTS idx_solution_design_proposals_project
  ON solution_design_proposals (project_id, status, id);

CREATE TABLE IF NOT EXISTS solution_design_notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL,
  proposal_id INTEGER,
  title TEXT NOT NULL,
  body TEXT,
  source_url TEXT,
  source_path TEXT,
  created_by INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_solution_design_notes_project
  ON solution_design_notes (project_id, id);

CREATE TABLE IF NOT EXISTS solution_design_stack (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  integration_id INTEGER NOT NULL,
  project_id INTEGER NOT NULL,
  repository TEXT NOT NULL,
  languages_json TEXT NOT NULL DEFAULT '[]',
  topics_json TEXT NOT NULL DEFAULT '[]',
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (integration_id, project_id, repository)
);
