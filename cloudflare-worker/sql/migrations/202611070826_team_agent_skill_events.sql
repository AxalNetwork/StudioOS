-- D4534 (#4534): attaching, re-pinning or removing a skill on a team agent is
-- recorded (the owner's answer A, 2026-11-07).
--
-- WHAT THIS ADDS:
--   team_agent_events     gains the kind `skills_changed`: who changed an
--                         agent's skills, and which were added (uid and
--                         version), re-pinned (from and to) or removed. It is
--                         written by `PUT /api/teams/agents/:uid/skills`,
--                         `POST /api/teams/skills/:uid/assign` and the
--                         add-agent route (`logSkillsChanged`, skillLinks.ts).
--
-- WHY team_agent_events IS REBUILT. As in 202611040924 (D4387): the kind is
-- held in a CHECK, which SQLite cannot widen in place. Nothing references the
-- table, so it is copied aside, dropped, recreated under its own name with the
-- same columns, references and index and the wider CHECK, and copied back with
-- every id and the AUTOINCREMENT high-water mark. No transaction statements
-- (D1 rejects them).


CREATE TABLE team_agent_events_keep_4534 AS SELECT * FROM team_agent_events;
CREATE TABLE team_agent_events_seq_keep_4534 AS SELECT seq FROM sqlite_sequence WHERE name = 'team_agent_events';
DROP TABLE team_agent_events;
CREATE TABLE team_agent_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_id INTEGER NOT NULL REFERENCES team_agents(id),
  actor_user_id INTEGER REFERENCES users(id),
  kind TEXT NOT NULL CHECK (kind IN ('added', 'paused', 'resumed', 'removed', 'cap_changed',
    'rulebook_changed', 'run', 'refused', 'proposal_decided', 'sponsor_changed', 'skills_changed')),
  usage_log_id INTEGER REFERENCES ai_usage_logs(id) ON DELETE SET NULL,
  proposal_uid TEXT,
  detail_json TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO team_agent_events (id, agent_id, actor_user_id, kind, usage_log_id, proposal_uid, detail_json, created_at)
SELECT id, agent_id, actor_user_id, kind, usage_log_id, proposal_uid, detail_json, created_at FROM team_agent_events_keep_4534 ORDER BY id;
CREATE INDEX IF NOT EXISTS idx_team_agent_events_agent ON team_agent_events (agent_id, id DESC);
-- The copy's INSERT … SELECT makes the sequence row even for no rows, so it is always there to raise.
UPDATE sqlite_sequence SET seq = MAX(seq, COALESCE((SELECT seq FROM team_agent_events_seq_keep_4534), 0)) WHERE name = 'team_agent_events';
DROP TABLE team_agent_events_keep_4534;
DROP TABLE team_agent_events_seq_keep_4534;
