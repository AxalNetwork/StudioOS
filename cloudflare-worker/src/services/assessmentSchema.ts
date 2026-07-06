/**
 * Task #44 — Lazy schema bootstrap for the Gamified Assessment system.
 *
 * Mirrors ensureTelegramSchema() / ensureSkillsTaxonomySchema(): migrations
 * 107_assessment_engine.sql (authoring) + 108_assessment_play.sql (runtime +
 * founder_origin_v1 seed) are the canonical apply path, but several recent
 * migrations have historically landed un-applied on prod (see replit.md /
 * GOTCHAS "Migrations & schema"). A CREATE TABLE IF NOT EXISTS on the cold path
 * keeps the assessment routes self-healing.
 *
 * SHAPE ONLY — this bootstrap NEVER seeds. The founder_origin_v1 reference
 * content (games/chapters/items/archetypes/badges) lives exclusively in
 * migration 108 (and the other five tracks in 110), so no hot path ever
 * bulk-inserts content. On a cold D1 the tables exist but may be empty until
 * the seed migration is applied.
 *
 * Cached per isolate (no re-execution on every hot request).
 */
import type { Env } from '../types';

let _ready = false;

/**
 * The six canonical track keys. For the seeded tracks the game `slug` == the
 * `track` key. Keep in lockstep with the seed migrations (108 / 110) — these
 * are stable identifiers; never rename one.
 */
export const ASSESSMENT_TRACKS = [
  'founder_origin_v1',
  'operators_path_v1',
  'thesis_lab_v1',
  'partner_playbook_v1',
  'advisor_compass_v1',
  'coachs_lens_v1',
] as const;
export type AssessmentTrack = (typeof ASSESSMENT_TRACKS)[number];

/** The investor/LP track additionally UPSERTs investor_profiles on complete. */
export const INVESTOR_TRACK: AssessmentTrack = 'thesis_lab_v1';

/** The six item mechanics (assessment_items.mechanic). */
export const ASSESSMENT_MECHANICS = [
  'dilemma',
  'card_sort',
  'sjt',
  'speed',
  'allocation',
  'reflection',
] as const;
export type AssessmentMechanic = (typeof ASSESSMENT_MECHANICS)[number];

/** Game lifecycle states (assessment_games.status). */
export const GAME_STATUSES = ['draft', 'published', 'archived'] as const;
export type GameStatus = (typeof GAME_STATUSES)[number];

/** Badge kinds (assessment_badges.kind). */
export const BADGE_KINDS = ['archetype', 'milestone', 'event'] as const;
export type BadgeKind = (typeof BADGE_KINDS)[number];

export async function ensureAssessmentSchema(env: Env): Promise<void> {
  if (_ready) return;
  try {
    await env.DB.batch([
      // ── Authoring (107) ──────────────────────────────────────────────────
      env.DB.prepare(`CREATE TABLE IF NOT EXISTS assessment_games (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        slug          TEXT NOT NULL UNIQUE,
        track         TEXT NOT NULL,
        title         TEXT NOT NULL,
        subtitle      TEXT,
        description   TEXT,
        target_role   TEXT,
        theme_json    TEXT NOT NULL DEFAULT '{}',
        status        TEXT NOT NULL DEFAULT 'draft',
        version       INTEGER NOT NULL DEFAULT 1,
        display_order INTEGER NOT NULL DEFAULT 0,
        created_at    TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
      )`),
      env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_assessment_games_status
        ON assessment_games (status, display_order)`),
      env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_assessment_games_track
        ON assessment_games (track)`),

      env.DB.prepare(`CREATE TABLE IF NOT EXISTS assessment_chapters (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        game_id       INTEGER NOT NULL REFERENCES assessment_games(id),
        slug          TEXT NOT NULL,
        title         TEXT NOT NULL,
        description   TEXT,
        display_order INTEGER NOT NULL DEFAULT 0,
        created_at    TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE (game_id, slug)
      )`),
      env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_assessment_chapters_game
        ON assessment_chapters (game_id, display_order)`),

      env.DB.prepare(`CREATE TABLE IF NOT EXISTS assessment_items (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        game_id       INTEGER NOT NULL REFERENCES assessment_games(id),
        chapter_id    INTEGER NOT NULL REFERENCES assessment_chapters(id),
        slug          TEXT NOT NULL UNIQUE,
        mechanic      TEXT NOT NULL,
        prompt        TEXT NOT NULL,
        subprompt     TEXT,
        options_json  TEXT NOT NULL DEFAULT '{}',
        measures_json TEXT NOT NULL DEFAULT '{}',
        loads_json    TEXT NOT NULL DEFAULT '{}',
        config_json   TEXT NOT NULL DEFAULT '{}',
        display_order INTEGER NOT NULL DEFAULT 0,
        is_active     INTEGER NOT NULL DEFAULT 1,
        created_at    TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
      )`),
      env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_assessment_items_chapter
        ON assessment_items (chapter_id, display_order)`),
      env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_assessment_items_game
        ON assessment_items (game_id, is_active, display_order)`),
      env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_assessment_items_mechanic
        ON assessment_items (mechanic)`),

      env.DB.prepare(`CREATE TABLE IF NOT EXISTS assessment_archetypes (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        game_id       INTEGER NOT NULL REFERENCES assessment_games(id),
        track         TEXT NOT NULL,
        slug          TEXT NOT NULL UNIQUE,
        label         TEXT NOT NULL,
        tagline       TEXT,
        description   TEXT,
        centroid_json TEXT NOT NULL DEFAULT '{}',
        badge_slug    TEXT,
        display_order INTEGER NOT NULL DEFAULT 0,
        created_at    TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
      )`),
      env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_assessment_archetypes_game
        ON assessment_archetypes (game_id, display_order)`),
      env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_assessment_archetypes_track
        ON assessment_archetypes (track)`),

      env.DB.prepare(`CREATE TABLE IF NOT EXISTS assessment_badges (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        slug          TEXT NOT NULL UNIQUE,
        label         TEXT NOT NULL,
        description   TEXT,
        kind          TEXT NOT NULL DEFAULT 'milestone',
        icon          TEXT,
        criteria_json TEXT NOT NULL DEFAULT '{}',
        xp_reward     INTEGER NOT NULL DEFAULT 0,
        display_order INTEGER NOT NULL DEFAULT 0,
        is_active     INTEGER NOT NULL DEFAULT 1,
        created_at    TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
      )`),
      env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_assessment_badges_kind
        ON assessment_badges (kind, display_order)`),

      // ── Runtime / play (108) ─────────────────────────────────────────────
      env.DB.prepare(`CREATE TABLE IF NOT EXISTS assessment_sessions (
        id                 INTEGER PRIMARY KEY AUTOINCREMENT,
        public_id          TEXT NOT NULL UNIQUE,
        user_id            INTEGER NOT NULL REFERENCES users(id),
        game_id            INTEGER NOT NULL REFERENCES assessment_games(id),
        game_slug          TEXT NOT NULL,
        game_version       INTEGER NOT NULL DEFAULT 1,
        status             TEXT NOT NULL DEFAULT 'in_progress',
        current_chapter_id INTEGER,
        current_item_id    INTEGER,
        progress_json      TEXT NOT NULL DEFAULT '{}',
        started_at         TEXT NOT NULL DEFAULT (datetime('now')),
        completed_at       TEXT,
        created_at         TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at         TEXT NOT NULL DEFAULT (datetime('now'))
      )`),
      env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_assessment_sessions_user
        ON assessment_sessions (user_id, status, updated_at)`),
      env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_assessment_sessions_game
        ON assessment_sessions (game_id, status)`),

      env.DB.prepare(`CREATE TABLE IF NOT EXISTS assessment_responses (
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
      )`),
      env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_assessment_responses_session
        ON assessment_responses (session_id)`),
      env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_assessment_responses_user
        ON assessment_responses (user_id)`),

      env.DB.prepare(`CREATE TABLE IF NOT EXISTS assessment_results (
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
      )`),
      env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_assessment_results_user
        ON assessment_results (user_id, track, updated_at)`),
      env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_assessment_results_track
        ON assessment_results (track)`),

      env.DB.prepare(`CREATE TABLE IF NOT EXISTS user_xp (
        user_id    INTEGER PRIMARY KEY REFERENCES users(id),
        xp         INTEGER NOT NULL DEFAULT 0,
        level      INTEGER NOT NULL DEFAULT 1,
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      )`),

      env.DB.prepare(`CREATE TABLE IF NOT EXISTS user_badges (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id    INTEGER NOT NULL REFERENCES users(id),
        badge_slug TEXT NOT NULL REFERENCES assessment_badges(slug),
        source     TEXT NOT NULL DEFAULT 'assessment',
        meta_json  TEXT NOT NULL DEFAULT '{}',
        awarded_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE (user_id, badge_slug)
      )`),
      env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_user_badges_user
        ON user_badges (user_id, awarded_at)`),
    ]);
    _ready = true;
  } catch (err) {
    console.warn('[assessmentSchema] ensure failed', err);
  }
}
