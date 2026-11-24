-- D7818 (#7818): owner-only notes belong to the subject, not a study alternative.
CREATE TABLE IF NOT EXISTS research_project_subject_notes (
 subject_id INTEGER PRIMARY KEY REFERENCES research_project_subjects(id) ON DELETE CASCADE,
 rationale TEXT CHECK(rationale IS NULL OR length(rationale)<=4000),
 private_note TEXT CHECK(private_note IS NULL OR length(private_note)<=10000),
 status TEXT NOT NULL DEFAULT 'considering' CHECK(length(status) BETWEEN 1 AND 40),
 next_action TEXT CHECK(next_action IS NULL OR length(next_action)<=1000),
 due_day TEXT CHECK(due_day IS NULL OR (length(due_day)=10 AND date(due_day) IS NOT NULL AND date(due_day)=due_day)),
 revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>=1),
 updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
