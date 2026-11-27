-- D5157 part 4: one saved brief per Research Project.
CREATE TABLE IF NOT EXISTS research_project_briefs (
  project_id INTEGER PRIMARY KEY REFERENCES research_projects(id) ON DELETE CASCADE,
  sections_json TEXT NOT NULL CHECK (json_valid(sections_json)),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
