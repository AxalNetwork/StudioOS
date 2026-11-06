// D4160 (#4160, H2 of #4137) — HQ › AI agents › Skills library › From Axal:
// the lifecycle of Axal's own skills. Worker: routes/admin_hq_skills.ts
// (/api/admin/ai-agents/skills), Super Admin only (403 otherwise). Creating,
// editing and the single publish stay on /teams/skills (teamAgents.js); publish
// answers 409 needs_approval | golden_cases_failing { pass, total } for an Axal skill,
// and every save answers 400 tool_not_read_only { tool } for a write-capable tool.
//   GET  /admin/ai-agents/skills                    → { skills: [{ uid, name, area, level, status: draft|in_review|published|retired,
//                                                        version | null, agents, tokens_per_run: null, golden: { pass, total, meets_bar }, last_eval }], pass_bar }
//   GET  /admin/ai-agents/skills/:uid               → { skill, review: { open, approved, history }, cases, evals, versions, retired }
//   GET  /admin/ai-agents/skills/:uid/diff?from=vN&to=draft|vM → { from, to, frontmatter: [{ field, from, to }], steps: [{ op, text }] }
//   POST /admin/ai-agents/skills/:uid/review         { reviewer_uid } → 201 { status: 'in_review', review };
//                                                    422 reviewer_invalid | reviewer_is_author; 409 review_open | retired
//   POST /admin/ai-agents/skills/:uid/review/approve { comment? } → { status, review }; 403 self_approval | not_reviewer; 409 no_review | review_stale
//   POST /admin/ai-agents/skills/:uid/review/request-changes { comment } → { status, review }; 400 comment_required
//   PUT  /admin/ai-agents/skills/:uid/cases          { cases: [{ uid?, name, input: { records }, expect }], reason } → { evals };
//                                                    400 reason_required | case_invalid | case_has_email
//   POST /admin/ai-agents/skills/:uid/evals          { models? } → { evals }; 400 models_invalid; 409 no_cases
//   POST /admin/ai-agents/skills/:uid/retire         { replacement_uid, reason } → { status: 'retired', pinned_agents, replacement };
//                                                    422 replacement_required | replacement_invalid; 409 retired
//   POST /admin/ai-agents/skills/bulk                { action: publish|retire|evals, uids, reason, replacement_uid?, models? }
//                                                    → { action, results: [{ uid, ok, code?, message? }] }, each item on its own
import { request } from '../api.js';

const enc = encodeURIComponent;
const BASE = '/admin/ai-agents/skills';
const send = (path, method, body) => request(`${BASE}${path}`, { method, body: JSON.stringify(body ?? {}) });

export const adminHqSkillsApi = {
  list: (options) => request(BASE, options),
  get: (uid) => request(`${BASE}/${enc(uid)}`),
  diff: (uid, { from, to } = {}) => {
    const q = new URLSearchParams(Object.entries({ from, to }).filter(([, v]) => v)).toString();
    return request(`${BASE}/${enc(uid)}/diff${q ? `?${q}` : ''}`);
  },
  requestReview: (uid, reviewerUid) => send(`/${enc(uid)}/review`, 'POST', { reviewer_uid: reviewerUid }),
  approve: (uid, comment) => send(`/${enc(uid)}/review/approve`, 'POST', { comment }),
  requestChanges: (uid, comment) => send(`/${enc(uid)}/review/request-changes`, 'POST', { comment }),
  setCases: (uid, cases, reason) => send(`/${enc(uid)}/cases`, 'PUT', { cases, reason }),
  runEvals: (uid, models) => send(`/${enc(uid)}/evals`, 'POST', models ? { models } : {}),
  retire: (uid, replacementUid, reason) => send(`/${enc(uid)}/retire`, 'POST', { replacement_uid: replacementUid, reason }),
  bulk: (action, uids, { reason, replacementUid, models } = {}) => send('/bulk', 'POST', { action, uids, reason, replacement_uid: replacementUid, models }),
};
