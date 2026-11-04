// D4163 (#4163, H5 of #4137) — HQ › AI agents: the Overview tiles, the run
// log and one run, spend against the platform budget, and the admin audit.
// Worker: routes/admin_ai_agents.ts (/api/admin/ai-agents), Super Admin only.
// Read-only; a figure with no data comes back null ("Not recorded"), never 0.
//   GET /admin/ai-agents/overview
//   GET /admin/ai-agents/runs?agent=&skill=&area=&team=&status=&from=&to=&cursor=
//   GET /admin/ai-agents/runs/:uid
//   GET /admin/ai-agents/spend?by=agent|skill|company|model
//   GET /admin/ai-agents/audit?admin=&action=&area=&from=&to=&cursor=
//   GET /admin/ai-agents/audit.csv?(the same filters)
// D4162 (#4162, H4): the platform's AI policy (routes/admin_ai_agents_policy.ts).
//   GET    /admin/ai-agents/policy
//   PUT    /admin/ai-agents/policy/models  { areas, reason }
//   POST   /admin/ai-agents/policy/locks   { model, reason }
//   DELETE /admin/ai-agents/policy/locks/:model  { reason }
//   PUT    /admin/ai-agents/policy/caps    { platform_budget_microusd?, default_team_cap_microusd?, max_team_cap_microusd?, per_run_ceiling_microusd?, reason }
//   PUT    /admin/ai-agents/policy/tools   { tools, reason }
//   POST   /admin/ai-agents/policy/pause   { reason, confirm: 'PAUSE' }
//   POST   /admin/ai-agents/policy/resume  { reason }
// D4158 (#4158, H1): the roster, routes/admin_ai_agents_roster.ts. Every write
// takes a reason of at least 10 characters; values are never sent.
//   GET   /admin/ai-agents/roster
//   GET   /admin/ai-agents/roster/:key
//   PATCH /admin/ai-agents/roster/:key            { status? | name? tagline? story? goal? avatar?, trademark_checked?, reason }
//   PUT   /admin/ai-agents/roster/:key/defaults   { model, start_cap_usd, max_cap_usd, reason }
import { api, request } from '../api.js';

const enc = encodeURIComponent;
const q = (params = {}) => new URLSearchParams(Object.entries(params).filter(([, v]) => v != null && v !== '')).toString();

export const adminAiAgentsApi = {
  // D4423: HQ-only cohort preparation; email is input only, scope entries use the same POST.
  cohort: () => request('/admin/ai-agents/cohort'),
  addCohort: (email) => request('/admin/ai-agents/cohort', { method: 'POST', body: JSON.stringify({ email }) }),
  removeCohort: (uid) => request(`/admin/ai-agents/cohort/${enc(uid)}`, { method: 'DELETE' }),
  overview: () => request('/admin/ai-agents/overview'),
  runs: (filters = {}) => request(`/admin/ai-agents/runs?${q(filters)}`),
  run: (uid) => request(`/admin/ai-agents/runs/${enc(uid)}`),
  spend: (by = 'agent') => request(`/admin/ai-agents/spend?${q({ by })}`),
  audit: (filters = {}) => request(`/admin/ai-agents/audit?${q(filters)}`),
  auditCsv: (filters = {}) => api._downloadCsv(`/admin/ai-agents/audit.csv?${q(filters)}`, 'ai-agents-audit.csv'),
  policy: () => request('/admin/ai-agents/policy'),
  setModels: (areas, reason) => request('/admin/ai-agents/policy/models', { method: 'PUT', body: JSON.stringify({ areas, reason }) }),
  lockModel: (model, reason) => request('/admin/ai-agents/policy/locks', { method: 'POST', body: JSON.stringify({ model, reason }) }),
  unlockModel: (model, reason) => request(`/admin/ai-agents/policy/locks/${enc(model)}`, { method: 'DELETE', body: JSON.stringify({ reason }) }),
  setCaps: (caps, reason) => request('/admin/ai-agents/policy/caps', { method: 'PUT', body: JSON.stringify({ ...caps, reason }) }),
  setReadTools: (tools, reason) => request('/admin/ai-agents/policy/tools', { method: 'PUT', body: JSON.stringify({ tools, reason }) }),
  pauseAll: (reason, confirm) => request('/admin/ai-agents/policy/pause', { method: 'POST', body: JSON.stringify({ reason, confirm }) }),
  resumeAll: (reason) => request('/admin/ai-agents/policy/resume', { method: 'POST', body: JSON.stringify({ reason }) }),
  roster: () => request('/admin/ai-agents/roster'),
  rosterAgent: (key) => request(`/admin/ai-agents/roster/${enc(key)}`),
  rosterUpdate: (key, b) => request(`/admin/ai-agents/roster/${enc(key)}`, { method: 'PATCH', body: JSON.stringify(b) }),
  rosterDefaults: (key, b) => request(`/admin/ai-agents/roster/${enc(key)}/defaults`, { method: 'PUT', body: JSON.stringify(b) }),
};
