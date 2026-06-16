-- Task #ASSESS-2 — Gamified Assessment Engine: per-user play + results.
--
-- Builds on 107 (game content) and the canonical taxonomy (089/090). Stores a
-- user's playthroughs (sessions), their raw item responses, the computed result
-- of each finished session (value/skill vectors, archetype, badges, integrity
-- hash), plus the meta-game layer: XP/level/streak and awarded badges.
--
-- WHERE THE CANONICAL SIGNAL LANDS (by design, not in this file):
--   On session completion the route layer also UPSERTs the derived vectors into
--   the SHARED tables the matching engine already reads — user_values (094),
--   user_skills (091), and (for the investor_lp track) investor_profiles
--   (009/096). assessment_results below is the rich, game-native record;
--   user_values/user_skills are the normalized signal everything else consumes.
--   This is the whole point of the design: the game is a new front door onto
--   the SAME outputs, so co-founder / mentor / investor / partner matching
--   "just works" with zero changes to those consumers.
--
-- INTEGRITY: assessment_results.integrity_hash mirrors the score_snapshots
-- anti-cheat pattern (HMAC over the canonical result via SCORING_HMAC_SECRET)
-- so a published profile vector cannot be silently tampered with. Latency +
-- contradiction flags live in flags_json.
--
-- `users` is at D1's 100-column ALTER limit, so the meta-game state lives in
-- the user_xp SIDE TABLE keyed by user_id (the user_google_links pattern),
-- never as new columns on users.
--
-- Additive only, every statement is IF NOT EXISTS. Lazy bootstrap mirror in
-- services/assessmentSchema.ts::ensureAssessmentPlaySchema(). Apply:
--   npx wrangler d1 execute studioos-db --config wrangler.toml --remote \
--     --file=cloudflare-worker/sql/migrations/108_assessment_play.sql

-- ---------------------------------------------------------------------------
-- 1) assessment_sessions — one playthrough of a game by a user. A user may
--    re-play (a new "season"); the latest completed session per game is the
--    canonical one. status: in_progress | completed | abandoned.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS assessment_sessions (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  uid          TEXT NOT NULL UNIQUE DEFAULT (lower(hex(randomblob(16)))),
  user_id      INTEGER NOT NULL REFERENCES users(id),
  game_slug    TEXT NOT NULL,                     -- → assessment_games.slug
  track        TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'in_progress', -- in_progress|completed|abandoned
  current_chapter_slug TEXT,
  items_total  INTEGER NOT NULL DEFAULT 0,
  items_done   INTEGER NOT NULL DEFAULT 0,
  xp_awarded   INTEGER NOT NULL DEFAULT 0,
  started_at   TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT,
  updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_assessment_sessions_user
  ON assessment_sessions (user_id, game_slug, status);

-- ---------------------------------------------------------------------------
-- 2) assessment_responses — one row per answered item. choice_json holds the
--    mechanic-shaped answer (option key, ranking array, allocation map…).
--    latency_ms + confidence feed calibration / anti-gaming. One row per
--    (session, item); re-answering before completion updates in place.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS assessment_responses (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id  INTEGER NOT NULL REFERENCES assessment_sessions(id),
  item_slug   TEXT NOT NULL,                      -- → assessment_items.slug
  choice_json TEXT NOT NULL DEFAULT '{}',
  latency_ms  INTEGER,
  confidence  REAL,                               -- 0..1 self-rated / wagered
  skipped     INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (session_id, item_slug)
);
CREATE INDEX IF NOT EXISTS idx_assessment_responses_session
  ON assessment_responses (session_id);

-- ---------------------------------------------------------------------------
-- 3) assessment_results — computed output of a completed session. Rich,
--    game-native record (the card). value_vector_json/skill_vector_json mirror
--    what gets UPSERTed into user_values/user_skills. published gates whether
--    the card + vectors are visible to matching / the network.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS assessment_results (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  uid               TEXT NOT NULL UNIQUE DEFAULT (lower(hex(randomblob(16)))),
  session_id        INTEGER NOT NULL UNIQUE REFERENCES assessment_sessions(id),
  user_id           INTEGER NOT NULL REFERENCES users(id),
  track             TEXT NOT NULL,
  game_slug         TEXT NOT NULL,
  value_vector_json TEXT NOT NULL DEFAULT '{}',    -- {value_dimension_slug: −2..+2}
  skill_vector_json TEXT NOT NULL DEFAULT '{}',    -- {skill_category_slug: 0..5}
  confidence_json   TEXT NOT NULL DEFAULT '{}',    -- {dimension|axis: 0..1}
  archetype_slug    TEXT,                          -- → assessment_archetypes.slug
  archetype_score   REAL,                          -- closeness to the centroid
  badges_json       TEXT NOT NULL DEFAULT '[]',     -- badge slugs earned this run
  flags_json        TEXT NOT NULL DEFAULT '[]',     -- anomaly/calibration flags
  integrity_hash    TEXT,                          -- HMAC over the canonical result
  integrity_version TEXT NOT NULL DEFAULT 'v1',
  published         INTEGER NOT NULL DEFAULT 1,     -- visible to matching / network
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_assessment_results_user
  ON assessment_results (user_id, track, published);

-- ---------------------------------------------------------------------------
-- 4) user_xp — meta-game state. SIDE TABLE keyed by user_id (users is at the
--    D1 ALTER column limit). level is derived from xp by the route layer.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS user_xp (
  user_id        INTEGER PRIMARY KEY REFERENCES users(id),
  xp             INTEGER NOT NULL DEFAULT 0,
  level          INTEGER NOT NULL DEFAULT 1,
  streak_count   INTEGER NOT NULL DEFAULT 0,
  last_played_at TEXT,
  updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ---------------------------------------------------------------------------
-- 5) user_badges — awarded badges (catalog in 107). source records what
--    triggered it (game slug, event uid, …). One row per (user, badge).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS user_badges (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id),
  badge_slug  TEXT NOT NULL,                       -- → badge_catalog.slug
  source      TEXT,                                -- e.g. 'game:founder_origin_v1'
  awarded_at  TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (user_id, badge_slug)
);
CREATE INDEX IF NOT EXISTS idx_user_badges_user
  ON user_badges (user_id, awarded_at);
