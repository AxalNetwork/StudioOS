-- D4121 (#4121, Roster R5 of #4116): what each skill version adds to a run.
--
-- A run carries at most one skill (D1612 part D, #3954): a run that names a
-- skill joins that version's prompt (`skillPrompt` in
-- `services/agents/skillEval.ts`: its purpose, steps and allow-list) to the
-- system prompt. `context_tokens` is that text's size by the AI budget's own
-- estimate (`estTokens` in `services/ai/shapes.ts`: one token per four
-- characters, rounded up), so it is what the skill costs on each run that
-- uses it, before any output.
--
-- Written when a version is published (`skillPublish.ts`, in the same batch as
-- the version). Versions published before this migration have no row: the
-- reader (`runCost.ts` `pinTokens`) works the same figure out from the version
-- itself, so nothing is back-filled here; the prompt is built in code and SQL
-- cannot build it.
--
-- A sibling table, not a column on `agent_skill_versions`: a published version
-- is immutable (`trg_agent_skill_versions_immutable` refuses every UPDATE).
-- Keyed by the version, removed with its skill.
CREATE TABLE IF NOT EXISTS agent_skill_version_costs (
  skill_id INTEGER NOT NULL REFERENCES agent_skills(id) ON DELETE CASCADE,
  version INTEGER NOT NULL CHECK (version >= 1),
  context_tokens INTEGER NOT NULL CHECK (context_tokens >= 0),
  computed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (skill_id, version)
);
