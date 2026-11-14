-- Task #45 — Conversational archetype results.
--
-- The Profile & Fit page's Archetype card previously depended entirely on the
-- separate gamified assessment track (assessment_results.archetype_slug), so it
-- read "Archetype missing…" for every user who only ever talked to the advisor.
-- This table stores the archetype computed from the advisor's `archetype_trait`
-- fit answers (services/archetypeScoring.ts), parallel to axal_fit_scores.
--
-- Append-only history; the "current" archetype is the latest row per
-- (user_id, persona). Mirrored by ensureArchetypeSchema() so the worker
-- self-heals if this migration lands un-applied on prod.

CREATE TABLE IF NOT EXISTS profile_archetypes (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  persona         TEXT NOT NULL,
  archetype_slug  TEXT NOT NULL,
  archetype_label TEXT NOT NULL,
  traits_json     TEXT,
  confidence      REAL NOT NULL DEFAULT 0,
  distance        REAL NOT NULL DEFAULT 0,
  narrative       TEXT,
  computed_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_profile_archetypes_latest
  ON profile_archetypes (user_id, persona, computed_at);
