-- Epic 1 — Onboarding persona expansion (Cloudflare D1 / SQLite).
--
-- ONE-TIME APPLY (the CREATE TABLE statements use IF NOT EXISTS so this
-- file is safe to re-run; there are no ALTERs that would fail). The
-- worker also runs an idempotent in-process ensurePersonaSchema() at the
-- top of every /api/personas/* request for cold-start safety.
--
--   npx wrangler d1 execute studioos-db --file=sql/epic1_personas.sql
--   npx wrangler d1 execute studioos-db --remote --file=sql/epic1_personas.sql

CREATE TABLE IF NOT EXISTS user_personas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  persona_id TEXT NOT NULL,
  confidence REAL NOT NULL DEFAULT 0,
  manual_override INTEGER NOT NULL DEFAULT 0,
  source TEXT NOT NULL DEFAULT 'router',  -- 'router' | 'self_select' | 'admin_retag'
  is_primary INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, persona_id)
);
CREATE INDEX IF NOT EXISTS idx_user_personas_user ON user_personas(user_id);

CREATE TABLE IF NOT EXISTS user_profile_extras (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  persona_id TEXT NOT NULL,
  key TEXT NOT NULL,
  value TEXT,
  source TEXT NOT NULL DEFAULT 'onboarding',  -- 'onboarding' | 'admin_edit' | 'self_edit'
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, persona_id, key)
);
CREATE INDEX IF NOT EXISTS idx_user_profile_extras_user ON user_profile_extras(user_id);
CREATE INDEX IF NOT EXISTS idx_user_profile_extras_persona ON user_profile_extras(user_id, persona_id);
