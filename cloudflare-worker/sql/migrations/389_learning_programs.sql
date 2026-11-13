-- 389 — Learning programs (D558, #1159): a regional cohort of Learning
-- content, the admins assigned to follow it, and the members enrolled in it.
--
-- WHAT THIS ADDS TO 388. `visibility = 'program'` content (items, courses,
-- and 390's exercises and exams) was the Super Admin's only. It now opens to a
-- member actively enrolled in a published program that holds it, directly or
-- as a lesson of a course the program holds. `canSeeLearning` in
-- services/learningAccess.ts is still the one place that decides.
--
-- WHO WRITES WHAT. The Super Admin creates programs, sets their contents,
-- assigns admins and enrols members (routes/admin_learning_programs.ts, each
-- write recorded with `logAdminAction`). A member writes one row: their own
-- enrolment, into a published program whose `enrolment` is 'open'. An
-- assigned admin writes nothing: their view of the learners is read-only.
--
-- NOTHING IS DELETED FROM THE ENROLMENT RECORD. Unenrolling sets `status` to
-- 'removed', so who was enrolled, by whom and when stays on file.

CREATE TABLE IF NOT EXISTS learning_programs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  uid         TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  -- Free text, such as "Nordics" or a branch code. Null is not recorded.
  region      TEXT,
  description TEXT,
  enrolment   TEXT NOT NULL DEFAULT 'invite' CHECK (enrolment IN ('invite', 'open')),
  status      TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
  created_by  INTEGER NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_learning_programs_status ON learning_programs(status, enrolment);

CREATE TABLE IF NOT EXISTS learning_program_contents (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  program_id   INTEGER NOT NULL REFERENCES learning_programs(id),
  -- 'webinar' is reserved for D560 (#1161); the route refuses it until that store exists.
  subject_kind TEXT NOT NULL CHECK (subject_kind IN ('course', 'item', 'exam', 'exercise', 'webinar')),
  subject_uid  TEXT NOT NULL,
  position     INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (program_id, subject_kind, subject_uid)
);
CREATE INDEX IF NOT EXISTS idx_learning_program_contents_subject ON learning_program_contents(subject_kind, subject_uid);

CREATE TABLE IF NOT EXISTS learning_program_admins (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  program_id  INTEGER NOT NULL REFERENCES learning_programs(id),
  user_id     INTEGER NOT NULL,
  assigned_by INTEGER NOT NULL,
  assigned_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (program_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_learning_program_admins_user ON learning_program_admins(user_id);

CREATE TABLE IF NOT EXISTS learning_enrollments (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  program_id  INTEGER NOT NULL REFERENCES learning_programs(id),
  user_id     INTEGER NOT NULL,
  -- The member's own id on a self-enrolment; the Super Admin's otherwise.
  enrolled_by INTEGER NOT NULL,
  enrolled_at TEXT NOT NULL DEFAULT (datetime('now')),
  status      TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'removed')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (program_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_learning_enrollments_user ON learning_enrollments(user_id, status);
