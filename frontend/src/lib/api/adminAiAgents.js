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
  overview: () => request('/admin/ai-agents/overview'),
  runs: (filters = {}) => request(`/admin/ai-agents/runs?${q(filters)}`),
  run: (uid) => request(`/admin/ai-agents/runs/${enc(uid)}`),
  spend: (by = 'agent') => request(`/admin/ai-agents/spend?${q({ by })}`),
  audit: (filters = {}) => request(`/admin/ai-agents/audit?${q(filters)}`),
  auditCsv: (filters = {}) => api._downloadCsv(`/admin/ai-agents/audit.csv?${q(filters)}`, 'ai-agents-audit.csv'),
  roster: () => request('/admin/ai-agents/roster'),
  rosterAgent: (key) => request(`/admin/ai-agents/roster/${enc(key)}`),
  rosterUpdate: (key, b) => request(`/admin/ai-agents/roster/${enc(key)}`, { method: 'PATCH', body: JSON.stringify(b) }),
  rosterDefaults: (key, b) => request(`/admin/ai-agents/roster/${enc(key)}/defaults`, { method: 'PUT', body: JSON.stringify(b) }),
};
