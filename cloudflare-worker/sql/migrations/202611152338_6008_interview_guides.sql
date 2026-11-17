-- D6008 (#6008): the interview guide. The Validate v2 Discovery and ICP canvas (D5995, V27,
-- owner pick A) keeps one guide per venture and copies it onto an interview when it is used.
--
-- interview_guides: the venture's guide. `questions_json` is an array of
--   { id, text, group: { kind: 'hypothesis' | 'theme' | 'default' | 'other', ref }, by: 'me' | 'eadwyn' | 'default' }
--   in the founder's order. `version` rises by one on every save, and a save names the version
--   it read, so two tabs never overwrite each other. Eadwyn's questions enter only through an
--   accepted draft receipt; a hand edit makes a question the founder's.
-- interview_guide_copies: the copy taken onto one interview, and which of its questions were
--   asked. Marking a question asked changes the copy, never the venture's guide.
--
-- Additive: two new tables, no existing row changes.

CREATE TABLE IF NOT EXISTS interview_guides (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id      INTEGER NOT NULL UNIQUE REFERENCES projects(id) ON DELETE CASCADE,
  questions_json  TEXT    NOT NULL DEFAULT '[]',
  version         INTEGER NOT NULL DEFAULT 1,
  updated_by      INTEGER REFERENCES users(id),
  created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS interview_guide_copies (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id      INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  interview_id    INTEGER NOT NULL UNIQUE REFERENCES discovery_interviews(id) ON DELETE CASCADE,
  questions_json  TEXT    NOT NULL DEFAULT '[]',
  asked_json      TEXT    NOT NULL DEFAULT '[]',
  guide_version   INTEGER,
  copied_by       INTEGER REFERENCES users(id),
  copied_at       TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_interview_guide_copies_project ON interview_guide_copies(project_id);
