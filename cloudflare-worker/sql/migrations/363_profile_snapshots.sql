-- 363_profile_snapshots.sql — Profiling v2 history store (D357; Session 7 of
-- the Profiling v2 programme; documentation/architecture/PROFILING_V2.md §8).
--
-- Three things, one feature:
--
-- 1. profile_snapshots — APPEND-ONLY. One row each time a person's profile
--    changes materially (PROFILING_V2.md §7.6): displayed / computed /
--    secondary archetype, trait vector, skills per radar axis, values, Axal
--    values, the engine version and what triggered the recompute. A recompute
--    that changes nothing material writes nothing. Supersedes
--    profile_archetypes (migration 130) for v2: that table keeps its v1 rows
--    and v1 writes until Session 15 moves the card page, and is never read by
--    the v2 engine. A BEFORE UPDATE trigger refuses any rewrite; rows go only
--    with the account (ON DELETE CASCADE).
--
-- 2. profile_archetype_publish — the person's consent to show their displayed
--    archetype to other members (owner decision c). A side table keyed by
--    user_id because `users` is at D1's 100-column cap. No row = not
--    published. assessment_results.published (the gamified assessment's
--    flag) is NOT copied: publishing the conversational archetype is a new
--    consent.
--
-- 3. advisor_answers.answered_at — when the answer in the row was GIVEN.
--    The row is upserted on (conversation_id, question_id), so re-answering in
--    the same conversation replaced raw_value but left created_at at the first
--    answer; ageing and "latest answer wins" (§7.1–7.2) need the time of the
--    answer that is actually stored. The route sets it on insert and on every
--    re-answer; a NULL (rows from before this migration) reads as created_at.
--
-- STANDS ALONE: users and advisor_answers are existing tables. CREATE … IF NOT
-- EXISTS and one additive ALTER only, no BEGIN/COMMIT. Apply with the
-- ledger-driven runner:
--   npm run d1:migrate:remote

CREATE TABLE IF NOT EXISTS profile_snapshots (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id           INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  persona           TEXT NOT NULL CHECK (persona IN ('founder', 'investor', 'partner', 'advisor', 'coach')),
  engine_version    TEXT NOT NULL,
  trigger_kind      TEXT NOT NULL CHECK (trigger_kind IN ('answer', 'evidence', 'scheduled', 'engine_bump')),
  displayed_slug    TEXT,
  computed_slug     TEXT,
  secondary_slug    TEXT,
  confidence        REAL,
  margin            REAL,
  traits_json       TEXT NOT NULL,
  skills_json       TEXT NOT NULL,
  values_json       TEXT NOT NULL,
  axal_values_json  TEXT NOT NULL,
  hysteresis_json   TEXT,
  computed_at       TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_profile_snapshots_user_persona
  ON profile_snapshots (user_id, persona, id);

CREATE TRIGGER IF NOT EXISTS profile_snapshots_block_update
BEFORE UPDATE ON profile_snapshots
BEGIN
    SELECT RAISE(ABORT,
        'profile_snapshots is append-only (D357). A snapshot cannot be rewritten; a new recompute appends a new one.'
    );
END;

CREATE TABLE IF NOT EXISTS profile_archetype_publish (
  user_id     INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  published   INTEGER NOT NULL DEFAULT 0 CHECK (published IN (0, 1)),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

ALTER TABLE advisor_answers ADD COLUMN answered_at TEXT;
