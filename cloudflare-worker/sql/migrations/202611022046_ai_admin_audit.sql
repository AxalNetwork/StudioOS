-- D4163 (#4163, H5 of #4137): the admin audit of HQ › AI agents.
--
-- One row per Super Admin action on the AI agents panel (H1 roster, H2 skill
-- lifecycle, H3 company-skill moderation, H4 platform policy), written by
-- `recordAiAdminAction` in `services/agents/adminAudit.ts` and read by
-- `GET /api/admin/ai-agents/audit` (and its CSV).
--
--   at              when, UTC
--   admin_user_id   who; the read names them, never by email
--   action          what, a short machine name (`persona.hide`, `policy.pause`, …)
--   area            the panel area: roster, skills, company_skills, policy
--   subject         what it was done to, as a record reference (`persona:vesta`, `skill:<uid>`)
--   before_json     the value before, or NULL when there was none
--   after_json      the value after, or NULL when it was removed
--   reason          why, as the admin wrote it; every action has one
--
-- Append-only: no route updates or deletes a row, and the two triggers below
-- refuse it in the database too.
CREATE TABLE IF NOT EXISTS ai_admin_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  admin_user_id INTEGER NOT NULL REFERENCES users(id),
  action TEXT NOT NULL CHECK (length(action) BETWEEN 1 AND 64),
  area TEXT NOT NULL CHECK (area IN ('roster', 'skills', 'company_skills', 'policy')),
  subject TEXT NOT NULL CHECK (length(subject) BETWEEN 1 AND 200),
  before_json TEXT CHECK (before_json IS NULL OR json_valid(before_json)),
  after_json TEXT CHECK (after_json IS NULL OR json_valid(after_json)),
  reason TEXT NOT NULL CHECK (length(trim(reason)) BETWEEN 1 AND 500)
);
CREATE INDEX IF NOT EXISTS idx_ai_admin_audit_at ON ai_admin_audit (at, id);
CREATE INDEX IF NOT EXISTS idx_ai_admin_audit_area ON ai_admin_audit (area, at);
CREATE INDEX IF NOT EXISTS idx_ai_admin_audit_admin ON ai_admin_audit (admin_user_id, at);

CREATE TRIGGER IF NOT EXISTS trg_ai_admin_audit_no_update
BEFORE UPDATE ON ai_admin_audit
BEGIN
  SELECT RAISE(ABORT, 'ai_admin_audit rows are append-only');
END;

CREATE TRIGGER IF NOT EXISTS trg_ai_admin_audit_no_delete
BEFORE DELETE ON ai_admin_audit
BEGIN
  SELECT RAISE(ABORT, 'ai_admin_audit rows are append-only');
END;

-- The platform's AI policy, one row (id 1). H5 reads only its budget, which H4
-- (#4162) sets; H4's migration adds the rest of the policy to this row. With no
-- row, the budget is "Not recorded" (null), never 0.
CREATE TABLE IF NOT EXISTS ai_agent_policy (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  platform_budget_microusd INTEGER CHECK (platform_budget_microusd IS NULL OR platform_budget_microusd > 0),
  updated_by INTEGER REFERENCES users(id),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
