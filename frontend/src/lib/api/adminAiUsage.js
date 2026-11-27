// D791 (#2216) — HQ › AI usage, the Super Admin's read of every member's AI
// runs, and Pause AI and a member's cap. Worker: routes/admin_ai_usage.ts
// (/api/admin/ai-usage). Every call needs a Super Admin with a recent step-up;
// `request()` asks for the step-up when the Worker answers `step_up_required`.
//   GET    /admin/ai-usage?range=7d|30d|mtd        totals, splits, by day and model, top members, flags, paused, caps
//   GET    /admin/ai-usage/members?q=&range=       an exact user ID or an email prefix, at most 50
//   GET    /admin/ai-usage/members/:id?range=      one member: by model and by day, balance, allowance, limit, pause, cap, history
//   POST   /admin/ai-usage/members/:id/pause       { reason }
//   DELETE /admin/ai-usage/members/:id/pause       { reason }
//   PUT    /admin/ai-usage/members/:id/cap         { monthly_usd | null, reason }
import { request } from '../api.js';

const enc = encodeURIComponent;
const q = (params) => new URLSearchParams(Object.entries(params).filter(([, v]) => v != null && v !== '')).toString();

export const adminAiUsageApi = {
  read: (range = '30d') => request(`/admin/ai-usage?${q({ range })}`),
  search: (query, range = '30d') => request(`/admin/ai-usage/members?${q({ q: query, range })}`),
  member: (id, range = '30d') => request(`/admin/ai-usage/members/${enc(id)}?${q({ range })}`),
  pause: (id, reason) => request(`/admin/ai-usage/members/${enc(id)}/pause`, { method: 'POST', body: JSON.stringify({ reason }) }),
  resume: (id, reason) => request(`/admin/ai-usage/members/${enc(id)}/pause`, { method: 'DELETE', body: JSON.stringify({ reason }) }),
  setCap: (id, monthlyUsd, reason) => request(`/admin/ai-usage/members/${enc(id)}/cap`, {
    method: 'PUT', body: JSON.stringify({ monthly_usd: monthlyUsd, reason }),
  }),
};
