-- 626 — Venture scorecard part 3 (D1256, #3279): reviews, corrections, an
-- investor's weighting, the founder's sharing, and the quarterly fairness
-- check. Assigned to #3279 on the issue (D1253 §6).
--
-- venture_score_reviews — an Operating Partner's or Admin's review of one
--   scope (#2428 owner question 9 A): a note, or an adjustment of up to 15
--   points with a reason. The computed value it was made against is kept
--   beside it, and the scorecard row it read (`scorecard_uid`), so the
--   computed score is never overwritten: a review is shown next to it. The
--   latest row per (project, scope) is the one in force; older rows are its
--   history. `adjustment` 0 is a note.
--
-- venture_score_corrections — the founder's "Ask to correct" on one input
--   (#2428 bias guard 7). Open until staff resolve or decline it, with a
--   note. The input is named by its model key, never by a figure.
--
-- investor_scope_weights — "Your weighting" (owner question 3 A): one row per
--   person, eleven sliders 0–5 by scope key. It changes that person's sort
--   only and never a venture's score. No row is equal weighting.
--
-- venture_score_sharing — the founder's consent (owner question 2 A) and
--   advisor sharing (question 10 A). One row per (project, audience, user):
--   audience 'investors' with user_id 0 is the per-venture switch; with no
--   row it is on once the venture is listed (has a deal). Audience 'advisor'
--   names one advisor who may read the scorecard read-only; no row, no read.
--
-- venture_score_fairness — the quarterly fairness check (#2428 bias guard 9):
--   score and confidence by stage, sector, solo or team, and connector use,
--   as aggregates only, with every cell under five ventures suppressed. One
--   row per quarter, so a re-run of the job writes nothing.
--
-- Every statement that writes these is bound. No column holds a name, an
-- email or any of the bias guards' never-inputs.
--
-- Grep first (D689 D-t): none of these tables exists in an earlier migration
-- or the baseline.
--
-- STANDS ALONE under the runner: no BEGIN/COMMIT. Re-runnable: IF NOT EXISTS.

CREATE TABLE IF NOT EXISTS venture_score_reviews (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  uid             TEXT NOT NULL UNIQUE,
  project_id      INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  scope           TEXT NOT NULL,
  scorecard_uid   TEXT NOT NULL,
  model_version   TEXT NOT NULL,
  computed_value  REAL CHECK (computed_value IS NULL OR computed_value BETWEEN 0 AND 100),
  adjustment      INTEGER NOT NULL DEFAULT 0 CHECK (adjustment BETWEEN -15 AND 15),
  reason          TEXT,
  note            TEXT,
  reviewer_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  reviewer_role   TEXT NOT NULL CHECK (reviewer_role IN ('admin', 'partner')),
  created_at      TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (adjustment = 0 OR (reason IS NOT NULL AND computed_value IS NOT NULL)),
  CHECK (adjustment <> 0 OR note IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_venture_score_reviews_scope
  ON venture_score_reviews(project_id, scope, id);

CREATE TABLE IF NOT EXISTS venture_score_corrections (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  uid             TEXT NOT NULL UNIQUE,
  project_id      INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  scope           TEXT NOT NULL,
  input_key       TEXT NOT NULL,
  message         TEXT NOT NULL,
  state           TEXT NOT NULL DEFAULT 'open' CHECK (state IN ('open', 'resolved', 'declined')),
  requested_by    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at      TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  decided_by      INTEGER REFERENCES users(id) ON DELETE SET NULL,
  decided_at      TEXT,
  decision_note   TEXT
);
CREATE INDEX IF NOT EXISTS idx_venture_score_corrections_project
  ON venture_score_corrections(project_id, state, id);

CREATE TABLE IF NOT EXISTS investor_scope_weights (
  user_id         INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  weights_json    TEXT NOT NULL CHECK (json_valid(weights_json)),
  updated_at      TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS venture_score_sharing (
  project_id      INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  audience        TEXT NOT NULL CHECK (audience IN ('investors', 'advisor')),
  user_id         INTEGER NOT NULL DEFAULT 0,
  enabled         INTEGER NOT NULL CHECK (enabled IN (0, 1)),
  updated_by      INTEGER REFERENCES users(id) ON DELETE SET NULL,
  updated_at      TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (project_id, audience, user_id),
  CHECK ((audience = 'investors' AND user_id = 0) OR (audience = 'advisor' AND user_id > 0))
);

CREATE TABLE IF NOT EXISTS venture_score_fairness (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  quarter         TEXT NOT NULL UNIQUE CHECK (quarter GLOB '[0-9][0-9][0-9][0-9]-Q[1-4]'),
  model_version   TEXT NOT NULL,
  aggregate_json  TEXT NOT NULL CHECK (json_valid(aggregate_json)),
  computed_at     TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
