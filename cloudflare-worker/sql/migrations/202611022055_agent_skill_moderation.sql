-- D4161 (#4161, H3 of #4137): HQ moderation of company skills.
--
-- A Super Admin may flag a company's skill (it keeps running; the company's
-- editors are told why) or suspend it (the run gate refuses it at once; the
-- editors are told why). HQ never writes the skill itself: this table is the
-- only thing moderation writes, besides the admin audit row.
--
-- One row per action. A row is open while `cleared_at` is null; at most one is
-- open per skill. It closes when HQ clears it (`cleared_how = 'hq'`), when a
-- suspension replaces a flag (`'hq'`, with the suspension's reason), or when
-- the company publishes a new version (`'republished'`): that version starts
-- clean, and the versions the suspension covered (`version` and below) stay
-- refused at the run gate. Rows are never deleted, so the history stays.
--
-- Additive only: one new table, its indexes and one trigger.

CREATE TABLE IF NOT EXISTS agent_skill_moderation (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  skill_id INTEGER NOT NULL REFERENCES agent_skills(id),
  action TEXT NOT NULL CHECK (action IN ('flag', 'suspend')),
  -- The skill's `current_version` when the action was taken (0 for a draft).
  version INTEGER NOT NULL CHECK (version >= 0),
  reason TEXT NOT NULL CHECK (length(trim(reason)) BETWEEN 10 AND 500),
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  cleared_at TEXT,
  cleared_by INTEGER REFERENCES users(id),
  cleared_how TEXT CHECK (cleared_how IN ('hq', 'republished')),
  clear_reason TEXT,
  CHECK ((cleared_at IS NULL) = (cleared_how IS NULL))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_skill_moderation_open
  ON agent_skill_moderation (skill_id) WHERE cleared_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_agent_skill_moderation_skill
  ON agent_skill_moderation (skill_id, action, cleared_how);

-- The history is the audit of what HQ did to a company's skill: never deleted.
CREATE TRIGGER IF NOT EXISTS trg_agent_skill_moderation_kept
BEFORE DELETE ON agent_skill_moderation
BEGIN
  SELECT RAISE(ABORT, 'agent_skill_moderation rows are kept');
END;
