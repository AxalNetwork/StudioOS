-- 108_assessment_play.sql — Task #44
--
-- Runtime / "play" schema for the Gamified Assessment system (the authoring
-- schema is 107_assessment_engine.sql). Adds the per-session play tables and
-- the per-user reward state, then seeds the founder_origin_v1 REFERENCE GAME so
-- A1 can be exercised end to end and A4 can replicate the pattern for the other
-- five tracks (in 110). Full design: design/GAMIFIED_ASSESSMENT_SYSTEM.md
-- (§4 scoring, §5 archetypes, §6 XP/badges, §8 integrity).
--
-- Play flow: POST /sessions creates an assessment_sessions row; each answer is
-- an assessment_responses row (UNIQUE(session_id,item_id) so re-answering is an
-- upsert); /complete computes the value/skill vectors, writes one
-- assessment_results row (UNIQUE(session_id)) with an integrity_hash signed via
-- SCORING_HMAC_SECRET, UPSERTs user_values (094) + user_skills (091) (and
-- investor_profiles for the investor_lp track), bumps user_xp, and inserts the
-- earned user_badges (idempotent). user_xp is keyed by user_id PRIMARY KEY —
-- there is NO ALTER TABLE users anywhere (D1 100-column limit).
--
-- ADDITIVE-ONLY + IDEMPOTENT: tables are `CREATE TABLE IF NOT EXISTS` /
-- `CREATE INDEX IF NOT EXISTS`; every seed row is `INSERT OR IGNORE` keyed on a
-- UNIQUE column (game/chapter/item/archetype slug, badge slug), so re-applying
-- this file is a clean no-op. Seed inserts resolve foreign keys by slug via
-- SELECT, so they are stable regardless of AUTOINCREMENT ids. The lazy bootstrap
-- mirror lives in services/assessmentSchema.ts (shape only; it NEVER seeds —
-- seeds live exclusively in this migration / 110).
--
-- Apply after 107 (wrangler needs Node 22+ — see GOTCHAS "Migrations & schema"):
--   npx wrangler d1 execute studioos-db --config wrangler.toml --remote \
--     --file=cloudflare-worker/sql/migrations/108_assessment_play.sql

-- ===========================================================================
-- 1) RUNTIME TABLES
-- ===========================================================================

-- A single play-through of a game by a user. public_id is the opaque id used in
-- the /sessions/:id URLs (do not expose the AUTOINCREMENT id). game_version pins
-- the authored version so a result stays interpretable after the game is
-- re-published. current_* track the player's position for resume.
CREATE TABLE IF NOT EXISTS assessment_sessions (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  public_id          TEXT NOT NULL UNIQUE,
  user_id            INTEGER NOT NULL REFERENCES users(id),
  game_id            INTEGER NOT NULL REFERENCES assessment_games(id),
  game_slug          TEXT NOT NULL,
  game_version       INTEGER NOT NULL DEFAULT 1,
  status             TEXT NOT NULL DEFAULT 'in_progress',  -- in_progress | completed | abandoned
  current_chapter_id INTEGER,
  current_item_id    INTEGER,
  progress_json      TEXT NOT NULL DEFAULT '{}',
  started_at         TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at       TEXT,
  created_at         TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at         TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_assessment_sessions_user
  ON assessment_sessions (user_id, status, updated_at);
CREATE INDEX IF NOT EXISTS idx_assessment_sessions_game
  ON assessment_sessions (game_id, status);

-- One answer per item per session. response_json holds the mechanic-specific
-- payload (chosen option key(s), allocation map, card rank, reflection text).
-- response_value is an optional pre-resolved scalar; confidence_wager is the
-- optional 0..1 self-wager (sjt); latency_ms backs the `speed` weighting.
-- UNIQUE(session_id,item_id) makes POST /sessions/:id/respond idempotent.
CREATE TABLE IF NOT EXISTS assessment_responses (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id      INTEGER NOT NULL REFERENCES assessment_sessions(id),
  item_id         INTEGER NOT NULL REFERENCES assessment_items(id),
  user_id         INTEGER NOT NULL REFERENCES users(id),
  item_slug       TEXT,
  mechanic        TEXT,
  response_json   TEXT NOT NULL DEFAULT '{}',
  response_value  REAL,
  confidence_wager REAL,
  latency_ms      INTEGER,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (session_id, item_id)
);

CREATE INDEX IF NOT EXISTS idx_assessment_responses_session
  ON assessment_responses (session_id);
CREATE INDEX IF NOT EXISTS idx_assessment_responses_user
  ON assessment_responses (user_id);

-- The computed, signed outcome of a completed session. value_vector_json is the
-- −2..+2 per value_dimension map; skill_vector_json the 0..5 per skill axis map;
-- confidence_json the 0..1 per-dimension confidence; flags_json the contradiction
-- / low-confidence flags. integrity_hash is the HMAC over the canonical result
-- (SCORING_HMAC_SECRET, integrity_version pins the algorithm). published = the
-- user consented to surface this via GET /results/:userId. UNIQUE(session_id)
-- makes POST /sessions/:id/complete idempotent.
CREATE TABLE IF NOT EXISTS assessment_results (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id        INTEGER NOT NULL REFERENCES assessment_sessions(id),
  user_id           INTEGER NOT NULL REFERENCES users(id),
  game_id           INTEGER NOT NULL REFERENCES assessment_games(id),
  track             TEXT NOT NULL,
  value_vector_json TEXT NOT NULL DEFAULT '{}',
  skill_vector_json TEXT NOT NULL DEFAULT '{}',
  confidence_json   TEXT NOT NULL DEFAULT '{}',
  flags_json        TEXT NOT NULL DEFAULT '[]',
  archetype_slug    TEXT,
  archetype_label   TEXT,
  xp_awarded        INTEGER NOT NULL DEFAULT 0,
  integrity_hash    TEXT,
  integrity_version INTEGER NOT NULL DEFAULT 1,
  published         INTEGER NOT NULL DEFAULT 0,
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (session_id)
);

CREATE INDEX IF NOT EXISTS idx_assessment_results_user
  ON assessment_results (user_id, track, updated_at);
CREATE INDEX IF NOT EXISTS idx_assessment_results_track
  ON assessment_results (track);

-- Per-user gamification state. user_id PRIMARY KEY — a side table by design
-- (never ALTER TABLE users). level is derived from xp by the engine (§6).
CREATE TABLE IF NOT EXISTS user_xp (
  user_id    INTEGER PRIMARY KEY REFERENCES users(id),
  xp         INTEGER NOT NULL DEFAULT 0,
  level      INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Awarded badges. UNIQUE(user_id,badge_slug) makes every award idempotent, so
-- the engine can blindly INSERT OR IGNORE on each completion / check-in. source
-- distinguishes assessment vs event (phase F) vs admin grants.
CREATE TABLE IF NOT EXISTS user_badges (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id),
  badge_slug TEXT NOT NULL REFERENCES assessment_badges(slug),
  source     TEXT NOT NULL DEFAULT 'assessment',  -- assessment | event | admin
  meta_json  TEXT NOT NULL DEFAULT '{}',
  awarded_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (user_id, badge_slug)
);

CREATE INDEX IF NOT EXISTS idx_user_badges_user
  ON user_badges (user_id, awarded_at);

-- ===========================================================================
-- 2) REFERENCE SEED — founder_origin_v1
-- ---------------------------------------------------------------------------
-- A complete, playable founder track. 4 chapters, 10 items spanning all six
-- mechanics, scoring all 5 founder spectrums (089/090). Four of the five
-- spectrums are measured by >=2 mechanics so the contradiction check (design
-- §4) can fire and lower confidence. Skill loads touch several radar axes so a
-- skill vector forms. INSERT OR IGNORE on UNIQUE slugs → idempotent.
-- ===========================================================================

-- 2a) Game
INSERT OR IGNORE INTO assessment_games
  (slug, track, title, subtitle, description, target_role, status, version, display_order)
VALUES
  ('founder_origin_v1', 'founder_origin_v1', 'Founder Origin',
   'Discover your founder archetype',
   'A short, cinematic set of decisions that maps how you build: your mission anchor, speed vs craft, risk appetite, growth posture, and how you like to work. Ends with your Scout Report and archetype.',
   'founder', 'published', 1, 1);

-- 2b) Chapters
INSERT OR IGNORE INTO assessment_chapters (game_id, slug, title, description, display_order)
SELECT id, 'origin', 'Origin', 'Why you build.', 1
  FROM assessment_games WHERE slug = 'founder_origin_v1';
INSERT OR IGNORE INTO assessment_chapters (game_id, slug, title, description, display_order)
SELECT id, 'crucible', 'The Crucible', 'The hard calls.', 2
  FROM assessment_games WHERE slug = 'founder_origin_v1';
INSERT OR IGNORE INTO assessment_chapters (game_id, slug, title, description, display_order)
SELECT id, 'velocity', 'Velocity', 'Your reflexes under time.', 3
  FROM assessment_games WHERE slug = 'founder_origin_v1';
INSERT OR IGNORE INTO assessment_chapters (game_id, slug, title, description, display_order)
SELECT id, 'scout_report', 'Scout Report', 'Meet your archetype.', 4
  FROM assessment_games WHERE slug = 'founder_origin_v1';

-- 2c) Items
-- Chapter: origin
INSERT OR IGNORE INTO assessment_items
  (game_id, chapter_id, slug, mechanic, prompt, subprompt, options_json, measures_json, loads_json, config_json, display_order)
SELECT g.id, c.id, 'fo_mission_dilemma', 'dilemma',
  'What pulls you to build?',
  'Pick the one that is truer for you today.',
  '{"options":[{"key":"mission","label":"Chase a dent in the universe, even with an unproven model","loads":{"founder_mission_vs_profit":2,"product":1}},{"key":"profit","label":"Chase the clearest path to durable revenue","loads":{"founder_mission_vs_profit":-2,"finance_ops":1}}]}',
  '{"values":["founder_mission_vs_profit"],"skills":["product","finance_ops"]}',
  '{"founder_mission_vs_profit":{"scale":2}}',
  '{}', 1
FROM assessment_games g JOIN assessment_chapters c ON c.game_id = g.id
WHERE g.slug = 'founder_origin_v1' AND c.slug = 'origin';

INSERT OR IGNORE INTO assessment_items
  (game_id, chapter_id, slug, mechanic, prompt, subprompt, options_json, measures_json, loads_json, config_json, display_order)
SELECT g.id, c.id, 'fo_autonomy_cardsort', 'card_sort',
  'Keep the two days that energize you most.',
  'Drag your top two to the top of the deck.',
  '{"pick_n":2,"cards":[{"key":"flow","label":"Open-ended days where I follow the work","loads":{"founder_autonomy_vs_structure":2}},{"key":"ritual","label":"Clear rituals, owners, and a written plan","loads":{"founder_autonomy_vs_structure":-2}},{"key":"sprint","label":"Tight sprints with crisp acceptance criteria","loads":{"founder_autonomy_vs_structure":-1}},{"key":"explore","label":"Room to wander into adjacent bets","loads":{"founder_autonomy_vs_structure":1}}]}',
  '{"values":["founder_autonomy_vs_structure"]}',
  '{"founder_autonomy_vs_structure":{"scale":2}}',
  '{"pick_n":2}', 2
FROM assessment_games g JOIN assessment_chapters c ON c.game_id = g.id
WHERE g.slug = 'founder_origin_v1' AND c.slug = 'origin';

-- Chapter: crucible
INSERT OR IGNORE INTO assessment_items
  (game_id, chapter_id, slug, mechanic, prompt, subprompt, options_json, measures_json, loads_json, config_json, display_order)
SELECT g.id, c.id, 'fo_risk_dilemma', 'dilemma',
  'A bold launch could break out or flop. The quarter rides on it.',
  'Which call feels like you?',
  '{"options":[{"key":"bet","label":"Bet the quarter on the bold launch","loads":{"founder_risk_appetite":2}},{"key":"derisk","label":"Run a cheap test before committing","loads":{"founder_risk_appetite":-2,"product":1}}]}',
  '{"values":["founder_risk_appetite"],"skills":["product"]}',
  '{"founder_risk_appetite":{"scale":2}}',
  '{}', 1
FROM assessment_games g JOIN assessment_chapters c ON c.game_id = g.id
WHERE g.slug = 'founder_origin_v1' AND c.slug = 'crucible';

INSERT OR IGNORE INTO assessment_items
  (game_id, chapter_id, slug, mechanic, prompt, subprompt, options_json, measures_json, loads_json, config_json, display_order)
SELECT g.id, c.id, 'fo_growth_allocation', 'allocation',
  'You have one extra dollar of capital. Where does it go?',
  'Split 100 points across the two.',
  '{"total":100,"buckets":[{"key":"growth","label":"Pour into growth now","loads":{"founder_growth_vs_sustain":2,"gtm_sales":1}},{"key":"runway","label":"Extend runway and margins","loads":{"founder_growth_vs_sustain":-2,"finance_ops":1}}]}',
  '{"values":["founder_growth_vs_sustain"],"skills":["gtm_sales","finance_ops"]}',
  '{"founder_growth_vs_sustain":{"scale":2}}',
  '{"total":100}', 2
FROM assessment_games g JOIN assessment_chapters c ON c.game_id = g.id
WHERE g.slug = 'founder_origin_v1' AND c.slug = 'crucible';

INSERT OR IGNORE INTO assessment_items
  (game_id, chapter_id, slug, mechanic, prompt, subprompt, options_json, measures_json, loads_json, config_json, display_order)
SELECT g.id, c.id, 'fo_growth_dilemma', 'dilemma',
  'The category is heating up.',
  'How do you want to play it?',
  '{"options":[{"key":"blitz","label":"Raise big and blitzscale the category","loads":{"founder_growth_vs_sustain":2,"capital_network":1}},{"key":"default_alive","label":"Stay default-alive and compound","loads":{"founder_growth_vs_sustain":-2,"finance_ops":1}}]}',
  '{"values":["founder_growth_vs_sustain"],"skills":["capital_network","finance_ops"]}',
  '{"founder_growth_vs_sustain":{"scale":2}}',
  '{}', 3
FROM assessment_games g JOIN assessment_chapters c ON c.game_id = g.id
WHERE g.slug = 'founder_origin_v1' AND c.slug = 'crucible';

INSERT OR IGNORE INTO assessment_items
  (game_id, chapter_id, slug, mechanic, prompt, subprompt, options_json, measures_json, loads_json, config_json, display_order)
SELECT g.id, c.id, 'fo_mission_sjt', 'sjt',
  'A marquee customer signs only if you drop the part of the mission you care about most.',
  'Which lever do you pull?',
  '{"options":[{"key":"hold","label":"Hold the line on mission, walk from the deal","loads":{"founder_mission_vs_profit":2}},{"key":"adapt","label":"Trim the mission to land the logo and the cash","loads":{"founder_mission_vs_profit":-2,"gtm_sales":1}}],"confidence_wager":true}',
  '{"values":["founder_mission_vs_profit"],"skills":["gtm_sales"]}',
  '{"founder_mission_vs_profit":{"scale":2}}',
  '{"seniority_hint":{"skill":"gtm_sales","self_level":3}}', 4
FROM assessment_games g JOIN assessment_chapters c ON c.game_id = g.id
WHERE g.slug = 'founder_origin_v1' AND c.slug = 'crucible';

-- Chapter: velocity
INSERT OR IGNORE INTO assessment_items
  (game_id, chapter_id, slug, mechanic, prompt, subprompt, options_json, measures_json, loads_json, config_json, display_order)
SELECT g.id, c.id, 'fo_speed_timed', 'speed',
  'Ship it or hold it?',
  'Answer fast. The clock is part of the read.',
  '{"timer_ms":6000,"options":[{"key":"ship","label":"Ship the rough cut today","loads":{"founder_speed_vs_quality":2}},{"key":"polish","label":"Hold a week to polish","loads":{"founder_speed_vs_quality":-2}}]}',
  '{"values":["founder_speed_vs_quality"]}',
  '{"founder_speed_vs_quality":{"scale":2}}',
  '{"timer_ms":6000}', 1
FROM assessment_games g JOIN assessment_chapters c ON c.game_id = g.id
WHERE g.slug = 'founder_origin_v1' AND c.slug = 'velocity';

INSERT OR IGNORE INTO assessment_items
  (game_id, chapter_id, slug, mechanic, prompt, subprompt, options_json, measures_json, loads_json, config_json, display_order)
SELECT g.id, c.id, 'fo_speed_dilemma', 'dilemma',
  'How should the team release?',
  'Pick the rhythm you would set.',
  '{"options":[{"key":"fast","label":"Launch weekly, learn in public","loads":{"founder_speed_vs_quality":2,"product":1}},{"key":"craft","label":"Launch when it is genuinely great","loads":{"founder_speed_vs_quality":-2,"design":1}}]}',
  '{"values":["founder_speed_vs_quality"],"skills":["product","design"]}',
  '{"founder_speed_vs_quality":{"scale":2}}',
  '{}', 2
FROM assessment_games g JOIN assessment_chapters c ON c.game_id = g.id
WHERE g.slug = 'founder_origin_v1' AND c.slug = 'velocity';

INSERT OR IGNORE INTO assessment_items
  (game_id, chapter_id, slug, mechanic, prompt, subprompt, options_json, measures_json, loads_json, config_json, display_order)
SELECT g.id, c.id, 'fo_risk_sjt', 'sjt',
  'Runway shows nine months. A risky pivot could 5x the company or burn three months of cash.',
  'Your move?',
  '{"options":[{"key":"pivot","label":"Take the pivot, manage the burn","loads":{"founder_risk_appetite":2,"product":1}},{"key":"steady","label":"Protect runway, optimize what works","loads":{"founder_risk_appetite":-2,"finance_ops":1}}],"confidence_wager":true}',
  '{"values":["founder_risk_appetite"],"skills":["product","finance_ops"]}',
  '{"founder_risk_appetite":{"scale":2}}',
  '{"seniority_hint":{"skill":"product","self_level":3}}', 3
FROM assessment_games g JOIN assessment_chapters c ON c.game_id = g.id
WHERE g.slug = 'founder_origin_v1' AND c.slug = 'velocity';

-- Chapter: scout_report (reflection reveal — no scoring loads)
INSERT OR IGNORE INTO assessment_items
  (game_id, chapter_id, slug, mechanic, prompt, subprompt, options_json, measures_json, loads_json, config_json, display_order)
SELECT g.id, c.id, 'fo_reflection_reveal', 'reflection',
  'Your Scout Report',
  'Watch your radar fill in and meet your founder archetype.',
  '{"reveal":"scout_report","fields":[{"key":"takeaway","label":"What surprised you most?","kind":"text","optional":true}]}',
  '{}',
  '{}',
  '{"reveal":true}', 1
FROM assessment_games g JOIN assessment_chapters c ON c.game_id = g.id
WHERE g.slug = 'founder_origin_v1' AND c.slug = 'scout_report';

-- 2d) Archetypes — per-track centroids over the 5 founder spectrums + key skills.
INSERT OR IGNORE INTO assessment_archetypes
  (game_id, track, slug, label, tagline, description, centroid_json, badge_slug, display_order)
SELECT id, 'founder_origin_v1', 'fo_missionary', 'The Missionary',
  'Mission first, built to last.',
  'Anchored to the why. Bias to durable, sustainable building and craft over raw speed.',
  '{"values":{"founder_mission_vs_profit":2,"founder_speed_vs_quality":-1,"founder_risk_appetite":0,"founder_growth_vs_sustain":-1,"founder_autonomy_vs_structure":1},"skills":{"product":3,"finance_ops":2}}',
  'fo_archetype_missionary', 1
FROM assessment_games WHERE slug = 'founder_origin_v1';

INSERT OR IGNORE INTO assessment_archetypes
  (game_id, track, slug, label, tagline, description, centroid_json, badge_slug, display_order)
SELECT id, 'founder_origin_v1', 'fo_rocketeer', 'The Rocketeer',
  'Fast, bold, built to break out.',
  'High speed, high risk, hyper-growth. Comfortable raising big and moving first.',
  '{"values":{"founder_mission_vs_profit":0,"founder_speed_vs_quality":2,"founder_risk_appetite":2,"founder_growth_vs_sustain":2,"founder_autonomy_vs_structure":1},"skills":{"gtm_sales":3,"capital_network":3}}',
  'fo_archetype_rocketeer', 2
FROM assessment_games WHERE slug = 'founder_origin_v1';

INSERT OR IGNORE INTO assessment_archetypes
  (game_id, track, slug, label, tagline, description, centroid_json, badge_slug, display_order)
SELECT id, 'founder_origin_v1', 'fo_architect', 'The Architect',
  'Craft, structure, and durable systems.',
  'Quality-first and risk-aware, with a preference for process, structure, and deep technical foundations.',
  '{"values":{"founder_mission_vs_profit":1,"founder_speed_vs_quality":-2,"founder_risk_appetite":-1,"founder_growth_vs_sustain":-1,"founder_autonomy_vs_structure":-2},"skills":{"engineering":4,"product":3}}',
  'fo_archetype_architect', 3
FROM assessment_games WHERE slug = 'founder_origin_v1';

INSERT OR IGNORE INTO assessment_archetypes
  (game_id, track, slug, label, tagline, description, centroid_json, badge_slug, display_order)
SELECT id, 'founder_origin_v1', 'fo_maverick', 'The Maverick',
  'Independent, instinctive, unafraid.',
  'High autonomy and risk appetite with a fast, instinct-led style. Thrives without a playbook.',
  '{"values":{"founder_mission_vs_profit":1,"founder_speed_vs_quality":1,"founder_risk_appetite":2,"founder_growth_vs_sustain":1,"founder_autonomy_vs_structure":2},"skills":{"product":3,"gtm_sales":2}}',
  'fo_archetype_maverick', 4
FROM assessment_games WHERE slug = 'founder_origin_v1';

-- 2e) Badges — archetype awards + milestones. Global slugs (INSERT OR IGNORE).
INSERT OR IGNORE INTO assessment_badges
  (slug, label, description, kind, icon, criteria_json, xp_reward, display_order) VALUES
  ('fo_archetype_missionary', 'Missionary', 'Earned by being assigned The Missionary archetype.', 'archetype', 'compass',
    '{"track":"founder_origin_v1","archetype":"fo_missionary"}', 100, 1),
  ('fo_archetype_rocketeer',  'Rocketeer',  'Earned by being assigned The Rocketeer archetype.',  'archetype', 'rocket',
    '{"track":"founder_origin_v1","archetype":"fo_rocketeer"}', 100, 2),
  ('fo_archetype_architect',  'Architect',  'Earned by being assigned The Architect archetype.',  'archetype', 'ruler',
    '{"track":"founder_origin_v1","archetype":"fo_architect"}', 100, 3),
  ('fo_archetype_maverick',   'Maverick',   'Earned by being assigned The Maverick archetype.',   'archetype', 'zap',
    '{"track":"founder_origin_v1","archetype":"fo_maverick"}', 100, 4),
  ('first_steps', 'First Steps', 'Completed your first assessment.', 'milestone', 'flag',
    '{"event":"first_assessment_complete"}', 50, 5),
  ('founder_origin_complete', 'Origin Story', 'Completed the Founder Origin track.', 'milestone', 'award',
    '{"event":"game_complete","track":"founder_origin_v1"}', 75, 6);
