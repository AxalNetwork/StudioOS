-- 364_profile_evolution.sql — the Profiling v2 evolution loop (D358; Session 13
-- of the Profiling v2 programme; documentation/architecture/PROFILING_V2.md §7).
--
-- Session 7 (D357, migration 363) built the recompute: a profile is a pure
-- function of the answer ledger, the evidence and the date, and a material
-- change appends a snapshot. This migration holds what makes it MOVE over time:
--
-- 1. advisor_answer_revisions — APPEND-ONLY. advisor_answers is UNIQUE on
--    (conversation_id, question_id) and both write paths upsert, so answering
--    a question again in the same conversation — which is exactly what a
--    six-month re-ask ("is this still true?") does — overwrote the earlier
--    answer. The spec says the latest answer wins and the old one stays
--    (§7.1), and hysteresis is defined by replaying the ledger (§7.5), so a
--    lost answer would rewrite the past. The AFTER UPDATE trigger below copies
--    the row being replaced whenever a SAVED fit.* answer changes value or
--    time, on either write path, with no route change. Only fit.* answers are
--    kept: they are the ones the profile reads.
--
-- 2. profile_change_events — APPEND-ONLY. One row each time a person's
--    DISPLAYED archetype changes (after hysteresis), never for the first
--    classification or a computed-only flip. UNIQUE on (user, persona, day,
--    new archetype) so two recomputes racing (an answer and the nightly run)
--    record one event and send one notification (§7.7). It is the person's
--    own record: Session 15 draws the timeline from it, and the admin trends
--    read it only as counts.
--
-- 3. profile_evolution_state and profile_evolution_cursor — the nightly
--    run's bookkeeping. State: when each person was last evaluated, under
--    which engine version, so the run recomputes only people with something
--    new (evidence, a hysteresis clock, an engine bump, a monthly refresh).
--    Cursor: where the run stopped, so a population larger than one night's
--    budget carries over to the next night instead of starting again, and
--    the day Session 8's evidence pass last completed (its own cursor records
--    when a pass STARTED, which cannot tell a pass that spilled over from
--    yesterday from one finished today).
--
-- STANDS ALONE: advisor_answers and users are existing tables. CREATE … IF NOT
-- EXISTS only, no BEGIN/COMMIT, no ALTER. Apply with the ledger-driven runner:
--   npm run d1:migrate:remote

CREATE TABLE IF NOT EXISTS advisor_answer_revisions (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  answer_id    INTEGER NOT NULL,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  question_id  TEXT NOT NULL,
  raw_value    TEXT NOT NULL,
  answered_at  TEXT NOT NULL,
  archived_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_advisor_answer_revisions_user
  ON advisor_answer_revisions (user_id, question_id, id);

CREATE TRIGGER IF NOT EXISTS advisor_answers_keep_fit_revision
AFTER UPDATE OF raw_value, answered_at, saved_status ON advisor_answers
WHEN OLD.question_id LIKE 'fit.%'
  AND OLD.saved_status = 'saved'
  AND OLD.raw_value IS NOT NULL
  AND (NEW.raw_value IS NOT OLD.raw_value
       OR NEW.saved_status IS NOT OLD.saved_status
       OR COALESCE(NEW.answered_at, NEW.created_at) IS NOT COALESCE(OLD.answered_at, OLD.created_at))
BEGIN
  INSERT INTO advisor_answer_revisions (answer_id, user_id, question_id, raw_value, answered_at)
  VALUES (OLD.id, OLD.user_id, OLD.question_id, OLD.raw_value, COALESCE(OLD.answered_at, OLD.created_at));
END;

CREATE TRIGGER IF NOT EXISTS advisor_answer_revisions_block_update
BEFORE UPDATE ON advisor_answer_revisions
BEGIN
    SELECT RAISE(ABORT,
        'advisor_answer_revisions is append-only (D358). An earlier answer is kept as it was given.'
    );
END;

CREATE TABLE IF NOT EXISTS profile_change_events (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  persona         TEXT NOT NULL CHECK (persona IN ('founder', 'investor', 'partner', 'advisor', 'coach')),
  from_slug       TEXT NOT NULL,
  to_slug         TEXT NOT NULL,
  changed_on      TEXT NOT NULL,
  trigger_kind    TEXT NOT NULL CHECK (trigger_kind IN ('answer', 'evidence', 'scheduled', 'engine_bump')),
  engine_version  TEXT NOT NULL,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (user_id, persona, changed_on, to_slug)
);

CREATE INDEX IF NOT EXISTS idx_profile_change_events_changed_on
  ON profile_change_events (changed_on, persona);

CREATE TRIGGER IF NOT EXISTS profile_change_events_block_update
BEFORE UPDATE ON profile_change_events
BEGIN
    SELECT RAISE(ABORT,
        'profile_change_events is append-only (D358). A change that happened stays recorded.'
    );
END;

CREATE TABLE IF NOT EXISTS profile_evolution_state (
  user_id            INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  last_evaluated_at  TEXT NOT NULL,
  last_trigger       TEXT NOT NULL CHECK (last_trigger IN ('answer', 'evidence', 'scheduled', 'engine_bump')),
  engine_version     TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS profile_evolution_cursor (
  id                  INTEGER PRIMARY KEY CHECK (id = 1),
  last_user_id        INTEGER NOT NULL DEFAULT 0,
  pass_started_on     TEXT,
  pass_completed_on   TEXT,
  evidence_completed_on TEXT,
  updated_at          TEXT NOT NULL DEFAULT (datetime('now'))
);
