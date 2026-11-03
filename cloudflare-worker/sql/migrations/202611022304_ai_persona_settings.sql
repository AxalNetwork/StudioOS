-- D4158 (#4158, H1 of #4137): what HQ sets behind each of the 16 personas.
--
-- The personas themselves stay code (`services/agents/personas.ts`, D4117):
-- their values, risk and natural fit are never stored, so no route can write
-- them. This table holds only what a Super Admin may change, one row per
-- persona that has been changed; a persona with no row is offered, wears its
-- catalogue identity and has no team defaults.
--
--   persona_key         a key from personas.ts (the code checks it)
--   status              offered: in the Add-agent gallery
--                       hidden:  out of the gallery; teams that have it keep it
--                       retired: out of the gallery, and its live agents are
--                                paused (`persona_retired`) in the same batch
--   name, tagline, story, goal, avatar
--                       an override of the catalogue's identity, or NULL for
--                       the catalogue's own words
--   name_checked_by/_at who confirmed the trademark check for the current
--                       name override, and when
--   default_model_id    the model a team starts with, or NULL
--   start_cap_microusd  the monthly cap a team starts with, or NULL
--   max_cap_microusd    the highest monthly cap a team may set, or NULL
--
-- Every change also writes one row to `ai_admin_audit` (H5, D4163) in the
-- same batch, with the admin, the reason and the before and after.
CREATE TABLE IF NOT EXISTS ai_persona_settings (
  persona_key TEXT PRIMARY KEY CHECK (length(persona_key) BETWEEN 1 AND 40),
  status TEXT NOT NULL DEFAULT 'offered' CHECK (status IN ('offered', 'hidden', 'retired')),
  name TEXT CHECK (name IS NULL OR length(trim(name)) BETWEEN 1 AND 40),
  tagline TEXT CHECK (tagline IS NULL OR length(trim(tagline)) BETWEEN 1 AND 160),
  story TEXT CHECK (story IS NULL OR length(trim(story)) BETWEEN 1 AND 1200),
  goal TEXT CHECK (goal IS NULL OR length(trim(goal)) BETWEEN 1 AND 160),
  avatar TEXT CHECK (avatar IS NULL OR length(avatar) BETWEEN 1 AND 200),
  name_checked_by INTEGER REFERENCES users(id),
  name_checked_at TEXT,
  default_model_id TEXT CHECK (default_model_id IS NULL OR length(default_model_id) BETWEEN 1 AND 200),
  start_cap_microusd INTEGER CHECK (start_cap_microusd IS NULL OR start_cap_microusd > 0),
  max_cap_microusd INTEGER CHECK (max_cap_microusd IS NULL OR max_cap_microusd > 0),
  updated_by INTEGER REFERENCES users(id),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (start_cap_microusd IS NULL OR max_cap_microusd IS NULL OR start_cap_microusd <= max_cap_microusd)
);
