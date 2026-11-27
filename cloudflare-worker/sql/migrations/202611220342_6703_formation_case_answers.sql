-- D6703 (#6703): append-only intake snapshots, including source provenance.
CREATE TABLE IF NOT EXISTS formation_case_answers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  case_id INTEGER NOT NULL REFERENCES formation_cases(id),
  case_revision INTEGER NOT NULL,
  answers_json TEXT NOT NULL CHECK (json_valid(answers_json)),
  prefill_json TEXT NOT NULL CHECK (json_valid(prefill_json)),
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(case_id, case_revision)
);
CREATE TRIGGER IF NOT EXISTS formation_case_answers_immutable
BEFORE UPDATE ON formation_case_answers
BEGIN SELECT RAISE(ABORT, 'formation_case_answers: immutable answer set (D6703).'); END;
