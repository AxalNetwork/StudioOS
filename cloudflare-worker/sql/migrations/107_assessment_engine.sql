-- 107_assessment_engine.sql — Task #44
--
-- Authoring schema for the Gamified Assessment system (the "engine" side:
-- the content an admin authors). The runtime/play side (sessions, responses,
-- results, XP, badges) lives in 108_assessment_play.sql; the founder_origin_v1
-- reference content is seeded there too. Full design: design/GAMIFIED_ASSESSMENT_SYSTEM.md.
--
-- A "game" is one track (e.g. founder_origin_v1). A game has ordered chapters;
-- a chapter has ordered items; each item is one of the six mechanics
-- (dilemma | card_sort | sjt | speed | allocation | reflection). Items load
-- onto the canonical taxonomy from 089/090 — value_dimensions (value vector,
-- −2..+2) and skill_categories/skills (skill vector, 0..5) — so computed
-- results UPSERT straight into user_values (094) and user_skills (091).
-- Archetypes are per-track centroids over those vectors; the assignment engine
-- (A1) picks the nearest centroid. Badges are global award definitions.
--
-- ADDITIVE-ONLY + IDEMPOTENT: every statement is `CREATE TABLE IF NOT EXISTS`
-- or `CREATE INDEX IF NOT EXISTS`, so re-applying this file is a clean no-op.
-- There is NO `ALTER TABLE users` anywhere in the assessment system — all
-- user-attached play state lives in side tables keyed by user_id (108). Soft
-- FKs (REFERENCES …) document intent only; D1 does not enforce them. The
-- worker carries a lazy bootstrap mirror in services/assessmentSchema.ts
-- (CREATE TABLE IF NOT EXISTS on the cold path, SHAPE ONLY, never seeds) so
-- routes self-heal on a D1 that has not yet had this migration applied — same
-- pattern as services/skillsTaxonomySchema.ts / ensureTelegramSchema.
--
-- Apply (D1 "studioos-db" is bound as DB in repo-root wrangler.toml; wrangler
-- needs Node 22+ — see GOTCHAS "Migrations & schema"):
--   npx wrangler d1 execute studioos-db --config wrangler.toml --remote \
--     --file=cloudflare-worker/sql/migrations/107_assessment_engine.sql

-- ---------------------------------------------------------------------------
-- assessment_games — one row per track. slug is the stable identifier the API
-- and the seed key on (e.g. 'founder_origin_v1'); never rename a slug. track
-- carries the same six canonical track keys (founder_origin_v1, operators_path_v1,
-- thesis_lab_v1, partner_playbook_v1, mentor_compass_v1, coachs_lens_v1).
-- target_role hints which persona the track is for; status gates visibility to
-- players (only 'published' games appear in GET /games). version is bumped by
-- admin re-publish so old sessions can pin the version they were authored under.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS assessment_games (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  slug          TEXT NOT NULL UNIQUE,
  track         TEXT NOT NULL,                       -- canonical track key (== slug for the seeded tracks)
  title         TEXT NOT NULL,
  subtitle      TEXT,
  description   TEXT,
  target_role   TEXT,                                -- founder | operator | investor_lp | partner | mentor | coach
  theme_json    TEXT NOT NULL DEFAULT '{}',          -- player theming (accent, hero copy, card art keys)
  status        TEXT NOT NULL DEFAULT 'draft',       -- draft | published | archived
  version       INTEGER NOT NULL DEFAULT 1,
  display_order INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_assessment_games_status
  ON assessment_games (status, display_order);
CREATE INDEX IF NOT EXISTS idx_assessment_games_track
  ON assessment_games (track);

-- ---------------------------------------------------------------------------
-- assessment_chapters — ordered acts within a game. UNIQUE(game_id, slug)
-- keeps the seed idempotent and lets items resolve their chapter by slug.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS assessment_chapters (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id       INTEGER NOT NULL REFERENCES assessment_games(id),
  slug          TEXT NOT NULL,
  title         TEXT NOT NULL,
  description   TEXT,
  display_order INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (game_id, slug)
);

CREATE INDEX IF NOT EXISTS idx_assessment_chapters_game
  ON assessment_chapters (game_id, display_order);

-- ---------------------------------------------------------------------------
-- assessment_items — one decision per row. slug is globally UNIQUE so the seed
-- and admin authoring are idempotent. mechanic is one of the six. The three
-- JSON columns carry the authored content (see design §3 + §4):
--   options_json  — the choices the player sees. Each option carries its own
--                   per-option loads, e.g. for dilemma/sjt/speed:
--                     {"options":[{"key":"a","label":"…","loads":{"founder_mission_vs_profit":2}}, …]}
--                   card_sort: {"pick_n":3,"cards":[{"key":"…","label":"…","loads":{…}}, …]}
--                   allocation: {"total":100,"buckets":[{"key":"…","label":"…","loads":{…}}, …]}
--                   reflection: {"fields":[{"key":"…","label":"…","kind":"text|scale"}]}
--   measures_json — the canonical dimensions/axes this item measures, e.g.
--                     {"values":["founder_mission_vs_profit"],"skills":["product"]}
--                   The scoring engine groups items by these to run the
--                   contradiction check (a dimension hit by >=2 mechanics).
--   loads_json    — item-level load metadata (magnitude/scale hints + the
--                   loads-picker output) used to normalize option deltas into
--                   the −2..+2 value vector / 0..5 skill vector.
-- config_json carries mechanic config (timer_ms for speed, pick_n for
-- card_sort, total for allocation, seniority_hint for sjt → self_level).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS assessment_items (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id       INTEGER NOT NULL REFERENCES assessment_games(id),
  chapter_id    INTEGER NOT NULL REFERENCES assessment_chapters(id),
  slug          TEXT NOT NULL UNIQUE,
  mechanic      TEXT NOT NULL,                       -- dilemma | card_sort | sjt | speed | allocation | reflection
  prompt        TEXT NOT NULL,
  subprompt     TEXT,
  options_json  TEXT NOT NULL DEFAULT '{}',
  measures_json TEXT NOT NULL DEFAULT '{}',
  loads_json    TEXT NOT NULL DEFAULT '{}',
  config_json   TEXT NOT NULL DEFAULT '{}',
  display_order INTEGER NOT NULL DEFAULT 0,
  is_active     INTEGER NOT NULL DEFAULT 1,          -- 0 = retired from the deck
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_assessment_items_chapter
  ON assessment_items (chapter_id, display_order);
CREATE INDEX IF NOT EXISTS idx_assessment_items_game
  ON assessment_items (game_id, is_active, display_order);
CREATE INDEX IF NOT EXISTS idx_assessment_items_mechanic
  ON assessment_items (mechanic);

-- ---------------------------------------------------------------------------
-- assessment_archetypes — per-track personas defined by a centroid over the
-- track's value + skill vectors. assignArchetype(track, vectors) picks the
-- nearest centroid (Euclidean over the shared dimensions). centroid_json mirrors
-- the result vector shape, e.g.
--   {"values":{"founder_mission_vs_profit":2,"founder_speed_vs_quality":-1, …},
--    "skills":{"product":4,"capital_network":3, …}}
-- badge_slug names the archetype badge awarded on assignment (a row in
-- assessment_badges). UNIQUE(slug) keeps the seed idempotent.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS assessment_archetypes (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id       INTEGER NOT NULL REFERENCES assessment_games(id),
  track         TEXT NOT NULL,
  slug          TEXT NOT NULL UNIQUE,
  label         TEXT NOT NULL,
  tagline       TEXT,
  description   TEXT,
  centroid_json TEXT NOT NULL DEFAULT '{}',
  badge_slug    TEXT,                                -- soft link to assessment_badges.slug
  display_order INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_assessment_archetypes_game
  ON assessment_archetypes (game_id, display_order);
CREATE INDEX IF NOT EXISTS idx_assessment_archetypes_track
  ON assessment_archetypes (track);

-- ---------------------------------------------------------------------------
-- assessment_badges — global award definitions. kind groups how a badge is
-- earned (see design §6): archetype (assigned an archetype), milestone
-- (completion / streak), event (cross-system, awarded from event check-ins in
-- phase F). criteria_json documents the earn rule for the awarding engine;
-- xp_reward is added to user_xp when granted. Awards land in user_badges (108).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS assessment_badges (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  slug          TEXT NOT NULL UNIQUE,
  label         TEXT NOT NULL,
  description   TEXT,
  kind          TEXT NOT NULL DEFAULT 'milestone',   -- archetype | milestone | event
  icon          TEXT,                                -- lucide-react icon key
  criteria_json TEXT NOT NULL DEFAULT '{}',
  xp_reward     INTEGER NOT NULL DEFAULT 0,
  display_order INTEGER NOT NULL DEFAULT 0,
  is_active     INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_assessment_badges_kind
  ON assessment_badges (kind, display_order);
