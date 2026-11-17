-- D7077 (#7077): the agent queue's platform admission budget per model.
--
-- One row per (model, UTC minute, scope): how many agent runs of that model
-- the queue started for that team in that minute. `src/agents/modelBudget.ts`
-- reads the minute's total and the scope's fair share and increments the row
-- in one statement; the sweep deletes minutes older than ten. Nothing reads a
-- row unless AGENT_MODEL_RPM is set, so the table stays empty until then.
-- `scope_key` is `company:<id>` or `project:<id>`; no user, task, prompt or
-- output is stored.
CREATE TABLE IF NOT EXISTS agent_model_admissions (
  model     TEXT NOT NULL CHECK (length(model) BETWEEN 1 AND 128),
  minute    INTEGER NOT NULL,
  scope_key TEXT NOT NULL CHECK (length(scope_key) BETWEEN 1 AND 40),
  n         INTEGER NOT NULL DEFAULT 0 CHECK (n >= 0),
  PRIMARY KEY (model, minute, scope_key)
);
CREATE INDEX IF NOT EXISTS idx_agent_model_admissions_minute ON agent_model_admissions(minute);
