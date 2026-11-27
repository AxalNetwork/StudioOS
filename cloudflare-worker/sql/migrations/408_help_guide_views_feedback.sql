-- 408 — D603 (#1286): the Help Center's two missing stores, weekly guide
-- views and yes/no answers. Additive only.
--
-- A guide is addressed by its anchor, `<area>/<guide>`, for example
-- `capital/cap-table`: lower-case letters, digits and hyphens, one slash
-- between two non-empty parts, 3 to 120 characters. The Worker checks the
-- same shape before any write (routes/help_center.ts); these CHECKs hold it
-- in the table as well.
--
-- help_guide_views counts views per guide per UTC day. It has NO reader
-- identity: a count, an anchor and a day.
--
-- help_guide_view_marks is how a view is counted once per member per guide
-- per day. It does hold the member's id, so it is kept short: every view
-- write deletes the marks older than two days, and no mark outlives that.
--
-- help_guide_feedback holds one answer per member per guide (the last one
-- wins). `missing` is the one field a "No" opens: at most 500 characters,
-- and never with "yes".
CREATE TABLE IF NOT EXISTS help_guide_views (
  anchor  TEXT NOT NULL CHECK (
    length(anchor) BETWEEN 3 AND 120
    AND anchor NOT GLOB '*[^a-z0-9/-]*'
    AND instr(anchor, '/') > 1
    AND instr(substr(anchor, instr(anchor, '/') + 1), '/') = 0
    AND substr(anchor, -1) <> '/'
  ),
  day     TEXT NOT NULL CHECK (day GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  views   INTEGER NOT NULL DEFAULT 0 CHECK (views >= 0),
  PRIMARY KEY (anchor, day)
);
CREATE INDEX IF NOT EXISTS idx_help_guide_views_day ON help_guide_views (day);

CREATE TABLE IF NOT EXISTS help_guide_view_marks (
  user_id  INTEGER NOT NULL,
  anchor   TEXT NOT NULL,
  day      TEXT NOT NULL CHECK (day GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  PRIMARY KEY (user_id, anchor, day)
);
CREATE INDEX IF NOT EXISTS idx_help_guide_view_marks_day ON help_guide_view_marks (day);

CREATE TABLE IF NOT EXISTS help_guide_feedback (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  anchor      TEXT NOT NULL CHECK (
    length(anchor) BETWEEN 3 AND 120
    AND anchor NOT GLOB '*[^a-z0-9/-]*'
    AND instr(anchor, '/') > 1
    AND instr(substr(anchor, instr(anchor, '/') + 1), '/') = 0
    AND substr(anchor, -1) <> '/'
  ),
  user_id     INTEGER NOT NULL,
  answer      TEXT NOT NULL CHECK (answer IN ('yes', 'no')),
  missing     TEXT CHECK (missing IS NULL OR (answer = 'no' AND length(missing) BETWEEN 1 AND 500)),
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (anchor, user_id)
);
CREATE INDEX IF NOT EXISTS idx_help_guide_feedback_anchor ON help_guide_feedback (anchor);
