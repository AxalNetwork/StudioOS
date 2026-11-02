-- D4121 (#4121, Roster R5 of #4116): what each skill version adds to every run.
--
-- A skill version's SKILL.md is the context a run includes for it, so each
-- version's size, in tokens, is what it costs per run before any output.
-- `context_tokens` is the AI budget's own estimate (`estTokens` in
-- `services/ai/shapes.ts`: one token per four characters, rounded up, at
-- least one), computed when the version is published (`skillPublish.ts`, in
-- the same batch as the version) and back-filled here for the versions
-- already published.
--
-- A sibling table, not a column on `agent_skill_versions`: a published version
-- is immutable (`trg_agent_skill_versions_immutable` refuses every UPDATE), so
-- a column could not be back-filled without dropping that guard. Keyed by the
-- version, removed with its skill.
--
-- SQLite's length() counts characters, as String.length does for the text a
-- SKILL.md holds (letters, punctuation, Markdown); the two differ only on
-- characters outside the Basic Multilingual Plane, by one token per four.
CREATE TABLE IF NOT EXISTS agent_skill_version_costs (
  skill_id INTEGER NOT NULL REFERENCES agent_skills(id) ON DELETE CASCADE,
  version INTEGER NOT NULL CHECK (version >= 1),
  context_tokens INTEGER NOT NULL CHECK (context_tokens >= 0),
  computed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (skill_id, version)
);

INSERT OR IGNORE INTO agent_skill_version_costs (skill_id, version, context_tokens)
SELECT skill_id, version, CASE WHEN length(skill_md) = 0 THEN 0 ELSE MAX(1, (length(skill_md) + 3) / 4) END
  FROM agent_skill_versions;
