// D4161 (#4161, H3 of #4137) — HQ › AI agents › Skills library › Company
// skills: a Super Admin reads, flags and suspends the skills companies wrote,
// and never writes one. Worker: routes/admin_company_skills.ts
// (/api/admin/ai-agents/company-skills), Super Admin only (403 otherwise).
//   GET  /admin/ai-agents/company-skills?status=&q=&page=  → { skills: [Row], page, per_page: 25, total }
//        Row: { uid, name, company: { uid, name }, project: null, author: { uid, name } | null,
//               area: { slug, label } | null, tools, status, version | null }
//        status: published | in_review | flagged | suspended (filter); 400 status_invalid | page_invalid
//   GET  /admin/ai-agents/company-skills/:uid               → { skill: { …Row, purpose, steps, output_kind, skill_md, read_only: true },
//                                                              moderation: Moderation | null, history: [Moderation] }
//   POST /admin/ai-agents/company-skills/:uid/flag     { reason } → { status: 'flagged', moderation }; the skill keeps running
//   POST /admin/ai-agents/company-skills/:uid/suspend  { reason } → { status: 'suspended', moderation }; the run gate refuses it
//   POST /admin/ai-agents/company-skills/:uid/clear    { reason } → { status, moderation: null }
//        400 reason_required (10 to 500 characters); 404 not_found;
//        409 already_flagged | already_suspended | nothing_to_clear | moderation_conflict
//   Moderation: { action: 'flag'|'suspend', reason, version | null, by: { uid, name }, at,
//                 cleared: { at, how: 'hq'|'republished', reason, by } | null }
import { request } from '../api.js';

const enc = encodeURIComponent;
const BASE = '/admin/ai-agents/company-skills';
const qs = (params) => new URLSearchParams(Object.entries(params).filter(([, v]) => v != null && v !== '')).toString();
const post = (uid, action, reason) => request(`${BASE}/${enc(uid)}/${action}`, { method: 'POST', body: JSON.stringify({ reason }) });

export const adminCompanySkillsApi = {
  list: ({ status, q, page } = {}) => {
    const query = qs({ status, q, page });
    return request(`${BASE}${query ? `?${query}` : ''}`);
  },
  get: (uid) => request(`${BASE}/${enc(uid)}`),
  flag: (uid, reason) => post(uid, 'flag', reason),
  suspend: (uid, reason) => post(uid, 'suspend', reason),
  clear: (uid, reason) => post(uid, 'clear', reason),
};
