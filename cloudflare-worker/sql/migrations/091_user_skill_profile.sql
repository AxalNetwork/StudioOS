-- Task #11 — User Skill Profile (self ratings + peer endorsements).
--
-- Builds on the Skills & Values Taxonomy (migrations 089/090). Adds the two
-- per-user tables the skill-profile / radar / matching features read from:
--
--   user_skills        — a user's own proficiency self-rating per skill
--                        (0..5), with optional evidence link + years.
--   skill_endorsements — a peer's endorsement of another user on a specific
--                        skill (0..5), gated at the API layer to existing
--                        connections (an active cofounder_connections row).
--
-- Per-user proficiency lives HERE (not on the taxonomy tables, by design —
-- see migration 089's header). skill_id soft-references skills.id (no PRAGMA
-- foreign_keys in D1; the REFERENCES clause documents intent only).
--
-- Additive only, every statement is IF NOT EXISTS, so re-applying is a clean
-- no-op. The worker carries a lazy bootstrap mirror in
-- services/skillProfileSchema.ts (CREATE TABLE IF NOT EXISTS on the cold path)
-- so the routes self-heal on a D1 that has not yet had this migration applied
-- — same pattern as services/skillsTaxonomySchema.ts.
--
-- Apply (D1 "studioos-db" is bound as DB in repo-root wrangler.toml):
--   npx wrangler d1 execute studioos-db --config wrangler.toml --remote \
--     --file=cloudflare-worker/sql/migrations/091_user_skill_profile.sql

-- A user's self-assessed proficiency for a skill. self_level is the 0..5
-- proficiency rank (0 = not held; the row is normally deleted instead of
-- stored at 0). evidence_url is an optional public link backing the claim;
-- years is optional experience in (fractional) years.
CREATE TABLE IF NOT EXISTS user_skills (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id      INTEGER NOT NULL REFERENCES users(id),
  skill_id     INTEGER NOT NULL REFERENCES skills(id),
  self_level   INTEGER NOT NULL DEFAULT 0,        -- 0..5 proficiency self-rating
  evidence_url TEXT,
  years        REAL,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (user_id, skill_id),
  CHECK (self_level >= 0 AND self_level <= 5)
);

CREATE INDEX IF NOT EXISTS idx_user_skills_user  ON user_skills (user_id);
CREATE INDEX IF NOT EXISTS idx_user_skills_skill ON user_skills (skill_id);

-- A peer endorsement of endorsee_id by endorser_id on a single skill. level
-- is the endorser's 0..5 assessment. One row per (endorser, endorsee, skill);
-- re-endorsing updates the level/note. endorser_id <> endorsee_id (no self
-- endorsement). The API additionally requires an existing connection between
-- the two users before any write.
CREATE TABLE IF NOT EXISTS skill_endorsements (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  endorser_id INTEGER NOT NULL REFERENCES users(id),
  endorsee_id INTEGER NOT NULL REFERENCES users(id),
  skill_id    INTEGER NOT NULL REFERENCES skills(id),
  level       INTEGER NOT NULL DEFAULT 0,         -- 0..5 endorsed proficiency
  note        TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (endorser_id, endorsee_id, skill_id),
  CHECK (level >= 0 AND level <= 5),
  CHECK (endorser_id <> endorsee_id)
);

CREATE INDEX IF NOT EXISTS idx_skill_endorsements_endorsee ON skill_endorsements (endorsee_id);
CREATE INDEX IF NOT EXISTS idx_skill_endorsements_endorser ON skill_endorsements (endorser_id);
CREATE INDEX IF NOT EXISTS idx_skill_endorsements_skill    ON skill_endorsements (skill_id);
