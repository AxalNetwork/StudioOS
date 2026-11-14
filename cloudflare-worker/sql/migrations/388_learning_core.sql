-- 388 — the Learning center's core (D557, #1158): items, courses, modules,
-- lessons and each member's progress.
--
-- WHAT THIS IS. The base the rest of the Learning epic (#1157) builds on:
-- programs (#1159) extend who may see `visibility = 'program'` content,
-- exercises and exams (#1160) become lesson kinds that point into their own
-- tables, and the screens (#1163) read these through `routes/learning.ts`.
--
-- AUTHORED BY THE SUPER ADMIN ONLY. Every write goes through
-- `routes/admin_learning.ts` behind `requireSuperAdmin` and is recorded with
-- `logAdminAction`. Members write one thing: their own progress.
--
-- NULL IS NOT RECORDED, NEVER A GUESS. A video with no duration has no
-- duration (not 0); an item with no transcript shows "Not recorded"; a
-- progress row with no percent was opened, not measured at 0%.

CREATE TABLE IF NOT EXISTS learning_items (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  uid              TEXT NOT NULL UNIQUE,
  kind             TEXT NOT NULL CHECK (kind IN ('video', 'reading')),
  title            TEXT NOT NULL,
  summary          TEXT,
  -- A reading's body, markdown. Null on a video.
  body             TEXT,
  -- 'url' is a link on the allow-list in services/learningAccess.ts; 'r2' is
  -- an upload, which has no upload path yet and is refused by the route.
  video_source     TEXT CHECK (video_source IN ('url', 'r2')),
  video_url        TEXT,
  r2_key           TEXT,
  duration_seconds INTEGER CHECK (duration_seconds IS NULL OR duration_seconds >= 0),
  thumbnail_url    TEXT,
  -- The lesson player's transcript panel (canvas D566). Null reads "Not recorded".
  transcript       TEXT,
  topic            TEXT,
  level            TEXT CHECK (level IN ('intro', 'intermediate', 'advanced')),
  visibility       TEXT NOT NULL DEFAULT 'open' CHECK (visibility IN ('open', 'program')),
  status           TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
  created_by       INTEGER NOT NULL,
  created_at       TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at       TEXT NOT NULL DEFAULT (datetime('now')),
  published_at     TEXT
);
CREATE INDEX IF NOT EXISTS idx_learning_items_status ON learning_items(status, published_at);

CREATE TABLE IF NOT EXISTS learning_courses (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  uid               TEXT NOT NULL UNIQUE,
  slug              TEXT NOT NULL UNIQUE,
  title             TEXT NOT NULL,
  summary           TEXT,
  cover_url         TEXT,
  level             TEXT CHECK (level IN ('intro', 'intermediate', 'advanced')),
  estimated_minutes INTEGER CHECK (estimated_minutes IS NULL OR estimated_minutes >= 0),
  -- The course page's Resources list (canvas D566): a JSON array of
  -- {title, url}, every url https. Validated by the route; '[]' is "none".
  resources_json    TEXT NOT NULL DEFAULT '[]',
  visibility        TEXT NOT NULL DEFAULT 'open' CHECK (visibility IN ('open', 'program')),
  status            TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
  created_by        INTEGER NOT NULL,
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT NOT NULL DEFAULT (datetime('now')),
  published_at      TEXT
);
CREATE INDEX IF NOT EXISTS idx_learning_courses_status ON learning_courses(status, published_at);

CREATE TABLE IF NOT EXISTS learning_course_modules (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  uid        TEXT NOT NULL UNIQUE,
  course_id  INTEGER NOT NULL REFERENCES learning_courses(id),
  title      TEXT NOT NULL,
  position   INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_learning_modules_course ON learning_course_modules(course_id, position);

CREATE TABLE IF NOT EXISTS learning_lessons (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  uid        TEXT NOT NULL UNIQUE,
  module_id  INTEGER NOT NULL REFERENCES learning_course_modules(id),
  title      TEXT NOT NULL,
  position   INTEGER NOT NULL DEFAULT 0,
  kind       TEXT NOT NULL CHECK (kind IN ('video', 'reading', 'exercise', 'exam', 'webinar')),
  -- What the lesson opens: a learning_items uid (video, reading), an event
  -- slug (webinar), or an exercise or exam uid (#1160).
  ref_uid    TEXT,
  required   INTEGER NOT NULL DEFAULT 1 CHECK (required IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_learning_lessons_module ON learning_lessons(module_id, position);

CREATE TABLE IF NOT EXISTS learning_progress (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id          INTEGER NOT NULL,
  subject_kind     TEXT NOT NULL CHECK (subject_kind IN ('item', 'lesson', 'course')),
  subject_uid      TEXT NOT NULL,
  status           TEXT NOT NULL CHECK (status IN ('started', 'completed')),
  percent          INTEGER CHECK (percent IS NULL OR (percent >= 0 AND percent <= 100)),
  position_seconds INTEGER CHECK (position_seconds IS NULL OR position_seconds >= 0),
  started_at       TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at     TEXT,
  updated_at       TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (user_id, subject_kind, subject_uid)
);
CREATE INDEX IF NOT EXISTS idx_learning_progress_user ON learning_progress(user_id, status, updated_at);
