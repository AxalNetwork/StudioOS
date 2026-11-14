-- D5157 part 2 (#5157) — a Research Project's findings: Source fact, Eadwyn
-- interpretation and Your conclusion (canvas `design/incoming/Research v2
-- Page.dc.html`, board RS-02 C · Findings and its dark twin RS-12; spec RS-B
-- "FindingCard" and "CitationChip + PassagePanel").
--
-- THREE KINDS, ONE TABLE. A finding is a sentence kept with a project, and
-- its kind says whose sentence it is:
--   · source_fact: the member's sentence, backed by at least one passage an
--     Ask answer of this project cited from a document in its evidence;
--   · interpretation: Eadwyn's words, taken from one of the project's Ask
--     answers and decided on by the member (accepted, edited or discarded);
--   · conclusion: the member's own, with or without a source.
-- No route runs a model to write an interpretation. The proposal is an Ask
-- answer the project already holds; nothing is stored until the member
-- decides, and the decision is what this row records.
--
-- `state` BELONGS TO INTERPRETATIONS ONLY. The CHECKs hold it there: an
-- interpretation always has a state and the words Eadwyn proposed
-- (`proposed_text`), kept beside an edit and after a discard, so "what Eadwyn
-- said" is never overwritten by "what the member kept". A source fact or a
-- conclusion has neither: it was written by the member, so there is nothing to
-- accept.
--
-- ONE DECISION PER ANSWER PER PROJECT. The partial unique index stops a second
-- interpretation row for the same answer; a new decision updates the row.
-- Deleting the Ask answer keeps the decision (SET NULL): the member's words do
-- not disappear with the thread they came from.
--
-- CITATIONS ARE FROZEN. A citation keeps the document's uid and title and the
-- passage as the Ask answer recorded it, so a later re-index never changes what
-- a finding cited. `document_id` goes NULL when the document is deleted, and
-- the page then says the source was removed rather than guessing.
--
-- No transaction statements: D1 rejects them (scripts/check-sql-migrations.mjs).

CREATE TABLE IF NOT EXISTS research_project_findings (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  uid            TEXT NOT NULL UNIQUE,
  project_id     INTEGER NOT NULL REFERENCES research_projects(id) ON DELETE CASCADE,
  owner_user_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind           TEXT NOT NULL CHECK (kind IN ('source_fact', 'interpretation', 'conclusion')),
  text           TEXT NOT NULL CHECK (length(trim(text)) >= 1),
  proposed_text  TEXT,
  answer_id      INTEGER REFERENCES research_ask_answers(id) ON DELETE SET NULL,
  state          TEXT CHECK (state IS NULL OR state IN ('accepted', 'edited', 'discarded')),
  decided_by     INTEGER NOT NULL REFERENCES users(id),
  decided_at     TEXT NOT NULL DEFAULT (datetime('now')),
  created_by     INTEGER NOT NULL REFERENCES users(id),
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK ((kind = 'interpretation') = (state IS NOT NULL)),
  CHECK ((kind = 'interpretation') = (proposed_text IS NOT NULL))
);

-- The Findings tab: "this project's findings, newest first".
CREATE INDEX IF NOT EXISTS idx_research_project_findings_project
  ON research_project_findings(project_id, id DESC);

-- One decision per Ask answer per project, and the SET NULL from a deleted
-- answer looks its rows up here.
CREATE UNIQUE INDEX IF NOT EXISTS idx_research_project_findings_answer
  ON research_project_findings(project_id, answer_id)
  WHERE kind = 'interpretation' AND answer_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_research_project_findings_answer_id
  ON research_project_findings(answer_id);

CREATE TABLE IF NOT EXISTS research_project_finding_citations (
  finding_id    INTEGER NOT NULL REFERENCES research_project_findings(id) ON DELETE CASCADE,
  n             INTEGER NOT NULL CHECK (n >= 1),
  document_id   INTEGER REFERENCES research_documents(id) ON DELETE SET NULL,
  -- NULL only for an Ask citation recorded before citations carried the
  -- document's uid: the page says its source is not recorded.
  document_uid  TEXT,
  title         TEXT NOT NULL,
  -- The passage as the Ask answer recorded it; NULL when the citation names the
  -- document only (a conclusion may cite a source without a passage).
  passage       TEXT,
  page          INTEGER,
  -- The Ask answer the passage was recorded with.
  answer_id     INTEGER REFERENCES research_ask_answers(id) ON DELETE SET NULL,
  PRIMARY KEY (finding_id, n)
);

-- The SET NULL from a deleted document looks its citations up by document.
CREATE INDEX IF NOT EXISTS idx_research_project_finding_citations_document
  ON research_project_finding_citations(document_id);
CREATE INDEX IF NOT EXISTS idx_research_project_finding_citations_answer
  ON research_project_finding_citations(answer_id);
