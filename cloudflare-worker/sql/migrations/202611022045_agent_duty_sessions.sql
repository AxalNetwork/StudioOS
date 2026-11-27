-- #3957 (D1613 §AI agents, on D1530's E5 duties): an agent work session is a
-- duty with a skill. agent_duties gains:
--   kind           'duty' (E5's template duties, unchanged) or 'session' (#3957)
--   cadence        also 'once', with run_at (UTC) set exactly then
--   minute_utc     the minute of the slot (the sweep's 5-minute tick reaches it)
--   zone           the IANA zone the member chose, so a repeat keeps its local time
--   local_time     'HH:MM' in that zone, for a repeat
--   skill_id / skill_version   the agent's assigned skill and its pinned version (#3951, #3956)
--   target_kind / target_id    the record it works on, optional
--   instruction    at most 1,000 characters, untrusted: the run reads it inside the data wrapper
--   status         also 'done' (a once session after its claim)
-- template_key becomes optional (a session has none), and E5's one-live-duty-
-- per-template index applies to duties only, so an agent may have two
-- sessions of one skill.
--
-- SQLite cannot widen a CHECK in place, so the table is rebuilt the way 762
-- rebuilt scope_task_events: every row and id kept, the AUTOINCREMENT
-- high-water mark kept, every index recreated. No table references
-- agent_duties. No transaction statements (D1 rejects them).

CREATE TABLE agent_duties_s1 (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  agent_id INTEGER NOT NULL REFERENCES team_agents(id) ON DELETE CASCADE,
  kind TEXT NOT NULL DEFAULT 'duty' CHECK (kind IN ('duty', 'session')),
  template_key TEXT CHECK (template_key IS NULL OR length(template_key) BETWEEN 1 AND 100),
  title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  module TEXT,
  option TEXT,
  cadence TEXT NOT NULL CHECK (cadence IN ('once', 'daily', 'weekly', 'monthly')),
  weekday INTEGER CHECK (weekday IS NULL OR weekday BETWEEN 0 AND 6),
  day_of_month INTEGER CHECK (day_of_month IS NULL OR day_of_month BETWEEN 1 AND 31),
  hour_utc INTEGER NOT NULL CHECK (hour_utc BETWEEN 0 AND 23),
  minute_utc INTEGER NOT NULL DEFAULT 0 CHECK (minute_utc BETWEEN 0 AND 59),
  zone TEXT CHECK (zone IS NULL OR length(zone) BETWEEN 1 AND 64),
  local_time TEXT CHECK (local_time IS NULL OR (length(local_time) = 5 AND local_time GLOB '[0-2][0-9]:[0-5][0-9]')),
  run_at TEXT,
  skill_id INTEGER REFERENCES agent_skills(id),
  skill_version INTEGER CHECK (skill_version IS NULL OR skill_version >= 1),
  target_kind TEXT CHECK (target_kind IS NULL OR target_kind IN ('module', 'deck', 'meeting', 'deal', 'document')),
  target_id TEXT CHECK (target_id IS NULL OR length(target_id) BETWEEN 1 AND 100),
  instruction TEXT CHECK (instruction IS NULL OR length(instruction) BETWEEN 1 AND 1000),
  next_due_at TEXT NOT NULL,
  last_claimed_at TEXT,
  last_outcome TEXT CHECK (last_outcome IS NULL OR length(last_outcome) BETWEEN 1 AND 64),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'done', 'removed')),
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK ((cadence = 'weekly') = (weekday IS NOT NULL)),
  CHECK ((cadence = 'monthly') = (day_of_month IS NOT NULL)),
  CHECK ((cadence = 'once') = (run_at IS NOT NULL)),
  CHECK ((kind = 'duty') = (template_key IS NOT NULL)),
  CHECK (kind = 'session' OR (skill_id IS NULL AND target_kind IS NULL AND instruction IS NULL AND cadence <> 'once')),
  CHECK (kind = 'duty' OR skill_id IS NOT NULL),
  CHECK ((target_kind IS NULL) = (target_id IS NULL))
);

INSERT INTO agent_duties_s1 (id, uid, agent_id, kind, template_key, title, module, option, cadence, weekday, day_of_month, hour_utc,
    next_due_at, last_claimed_at, last_outcome, status, created_by, created_at, updated_at)
  SELECT id, uid, agent_id, 'duty', template_key, title, module, option, cadence, weekday, day_of_month, hour_utc,
    next_due_at, last_claimed_at, last_outcome, status, created_by, created_at, updated_at FROM agent_duties;
UPDATE sqlite_sequence SET seq = MAX(seq, (SELECT seq FROM sqlite_sequence WHERE name = 'agent_duties')) WHERE name = 'agent_duties_s1';
DROP TABLE agent_duties;
ALTER TABLE agent_duties_s1 RENAME TO agent_duties;

-- E5's one live duty per agent and template (409 duty_exists): duties only.
CREATE UNIQUE INDEX idx_agent_duties_template ON agent_duties (agent_id, template_key) WHERE status <> 'removed' AND kind = 'duty';
-- The sweep: active rows that are due.
CREATE INDEX idx_agent_duties_due ON agent_duties (status, next_due_at);
-- An agent's sessions, for the calendar read.
CREATE INDEX idx_agent_duties_agent_kind ON agent_duties (agent_id, kind, status);
