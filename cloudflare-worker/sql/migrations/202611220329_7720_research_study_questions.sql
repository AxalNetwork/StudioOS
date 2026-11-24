-- D7720 (#7720): questions, evidence snapshots and append-only study decisions.
-- Target kinds are deliberately Worker-owned, without a SQL enum (#7721).
-- No decision DELETE trigger: deleting a project must cascade through its study.
CREATE TABLE IF NOT EXISTS research_study_questions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  project_id INTEGER NOT NULL REFERENCES research_studies(project_id) ON DELETE CASCADE,
  topic TEXT NOT NULL CHECK (topic IN ('customer_definition','demand','size','competition','pricing','channels','risks')),
  text TEXT NOT NULL CHECK (length(trim(text)) BETWEEN 1 AND 1000),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','answered','set_aside')),
  answer TEXT CHECK (answer IS NULL OR length(trim(answer)) BETWEEN 1 AND 4000),
  gap_note TEXT CHECK (gap_note IS NULL OR length(trim(gap_note)) BETWEEN 1 AND 2000),
  next_validation_action TEXT CHECK (next_validation_action IS NULL OR length(trim(next_validation_action)) BETWEEN 1 AND 2000),
  position INTEGER NOT NULL CHECK (position >= 0),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_research_study_questions_project ON research_study_questions(project_id, position, id);
CREATE TABLE IF NOT EXISTS research_study_decisions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  project_id INTEGER NOT NULL REFERENCES research_studies(project_id) ON DELETE CASCADE,
  outcome TEXT NOT NULL CHECK (outcome IN ('enter','do_not_enter','test_further')),
  rationale TEXT NOT NULL CHECK (length(trim(rationale)) BETWEEN 1 AND 4000),
  reversing_assumptions TEXT CHECK (reversing_assumptions IS NULL OR length(trim(reversing_assumptions)) BETWEEN 1 AND 4000),
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_research_study_decisions_project ON research_study_decisions(project_id, id DESC);
CREATE TRIGGER IF NOT EXISTS research_study_decisions_immutable BEFORE UPDATE ON research_study_decisions
BEGIN SELECT RAISE(ABORT, 'study_decision_immutable'); END;
CREATE TABLE IF NOT EXISTS research_study_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  project_id INTEGER NOT NULL REFERENCES research_studies(project_id) ON DELETE CASCADE,
  question_id INTEGER REFERENCES research_study_questions(id) ON DELETE CASCADE,
  decision_id INTEGER REFERENCES research_study_decisions(id) ON DELETE CASCADE,
  direction TEXT NOT NULL CHECK (direction IN ('supports','contradicts','context')),
  note TEXT CHECK (note IS NULL OR length(trim(note)) BETWEEN 1 AND 2000),
  target_kind TEXT NOT NULL,
  finding_id INTEGER REFERENCES research_project_findings(id) ON DELETE SET NULL,
  finding_uid TEXT,
  finding_kind TEXT,
  finding_updated_at TEXT,
  CHECK ((question_id IS NULL) <> (decision_id IS NULL))
);
CREATE INDEX IF NOT EXISTS idx_research_study_links_question ON research_study_links(question_id);
CREATE INDEX IF NOT EXISTS idx_research_study_links_decision ON research_study_links(decision_id);
CREATE INDEX IF NOT EXISTS idx_research_study_links_finding ON research_study_links(finding_id);
CREATE INDEX IF NOT EXISTS idx_research_study_links_project ON research_study_links(project_id);
-- Enforce limits inside the write too, so concurrent requests cannot exceed them.
CREATE TRIGGER IF NOT EXISTS research_study_questions_limit BEFORE INSERT ON research_study_questions
WHEN (SELECT count(*) FROM research_study_questions WHERE project_id = NEW.project_id) >= 100
BEGIN SELECT RAISE(ABORT, 'study_question_limit'); END;
CREATE TRIGGER IF NOT EXISTS research_study_links_limit BEFORE INSERT ON research_study_links
WHEN (SELECT count(*) FROM research_study_links WHERE project_id = NEW.project_id) >= 1000
BEGIN SELECT RAISE(ABORT, 'study_link_limit'); END;
