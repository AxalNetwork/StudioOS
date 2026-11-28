// D9111 (#9111, D8071) — HQ › AI agents › Operations › Spend › Agent budgets: execution budgets.
// Worker: routes/admin_ai_agents_policy.ts (/api/admin/ai-agents/policy/budgets), Super Admin only;
// every write takes a reason and is audited in the same batch.
//   GET /admin/ai-agents/policy/budgets              { platform, workspaces: [{ scope_kind, scope_id, scope_name, caps, used }],
//                                                      agents: [{ agent_uid, name, role_key, scope_kind, scope_id, scope_name,
//                                                      period, caps, used, set_at, set_by }], halted: [{ run_uid, agent_uid,
//                                                      task_uid, refusal, ended_at }] }; 503 budget_unreadable
//   PUT /admin/ai-agents/policy/budgets/agents/:uid  { tokens_cap?, minutes_cap?, prs_per_day_cap?, retries_per_task_cap?, reason }
//                                                      → { agent_uid, period, caps, used, set_at, set_by }; 400 invalid_cap,
//                                                      reason_required, reason_too_long; 404 agent_not_found; 503 budget_unreadable
//   PUT /admin/ai-agents/policy/budgets/tasks/:uid   { tokens_cap?, minutes_cap?, retries_cap?, reason } → { task_uid, caps }; 404 task_not_found
//   PUT /admin/ai-agents/policy/budgets/workspace    { scope_kind, scope_id, agents_cap?, live_agents_cap?, ai_spend_cap_cents?,
//                                                      compute_spend_cap_cents?, reason } → { scope_kind, scope_id, caps, platform };
//                                                      400 invalid_scope; 404 scope_not_found; 409 above_platform_ceiling { field }
//   PUT /admin/ai-agents/policy/budgets/platform     { agents_cap?, live_agents_cap?, ai_spend_cap_cents?, compute_spend_cap_cents?, reason }
//                                                      → { platform }
// A field left out keeps its value; null clears it (no cap, or the platform figure for a workspace).
import { request } from '../api.js';

const BASE = '/admin/ai-agents/policy/budgets';
const enc = encodeURIComponent;
const put = (path, body) => request(`${BASE}${path}`, { method: 'PUT', body: JSON.stringify(body) });

export const aiAgentBudgetsApi = {
  budgets: () => request(BASE),
  setAgentBudget: (uid, caps, reason) => put(`/agents/${enc(uid)}`, { ...caps, reason }),
  setTaskBudget: (uid, caps, reason) => put(`/tasks/${enc(uid)}`, { ...caps, reason }),
  setWorkspaceBudget: (scopeKind, scopeId, caps, reason) => put('/workspace', { scope_kind: scopeKind, scope_id: scopeId, ...caps, reason }),
  setPlatformBudget: (caps, reason) => put('/platform', { ...caps, reason }),
};
