import { request } from '../api.js';

// D1190 (#3124) — Capital relationships part 2: the tool's Commitments and
// Match reads, on routes/cycle_raise.ts at /api/cycles/raise. The module's own
// D1191: owners/accepted co-founders work the pipeline; staff use a summary
// or a reasoned, read-only support response, never a persistent read grant.
//   commitments(p)   GET /cycles/raise/capital-relationships/commitments?project=
//                    → { currency, round, totals: { counted_cents, not_counted_cents, by_status, percent_of_target, … },
//                        investors: [{ key, prospect_id, name, chosen, lines: [{ source, status, counted, cents, currency, on, via }] }],
//                        sources: { prospects, round_calls, deals, mercury, closings }, words, basis }
//                    Each investor counts once, by their strongest line; a missing amount is null, never 0.
//                    Mercury's matched credits are read for the venture's founder alone.
//   match(p, q)      GET /cycles/raise/capital-relationships/match?project=&q=&hq_country=&focus=&size_band=&fit=&warm=1&sort=&limit=&offset=
//                    → the fund directory's answer, each fund with { fit, warm_paths, in_pipeline, stage: null };
//                      verified_investors: { count }, never names. `stage` is refused (400).
// D1193 (#3127) — part 5: Outreach, Activity and Eadwyn's proposals (`services/capRelTabs.ts`).
//   activity(p, q)        GET  …/activity?project=&q=&kind=&investor=&page=   → { items, total, page, page_size, kinds, not_here }
//   materials(p)          GET  …/materials?project=   → { items: [{ prospect_id, name, deck, data_room, call }], basis }
//   proposals(p)          GET  …/proposals?project=   → { proposals, drafts }, the caller's own open ones
//   proposeFromNote(p, b) POST …/proposals { prospect_id, event_id? }   one metered run over a logged note
//   acceptProposal(p, uid, edited?)  POST …/proposals/:uid/accept   written through the one prospect writer
//   draft(p, b)           POST …/drafts { prospect_id, purpose, via? }   one metered run; the founder sends it
//   A proposal or draft is edited or dismissed through `railProposalsApi.decide`.
const MATCH_KEYS = ['q', 'hq_country', 'focus', 'size_band', 'fit', 'warm', 'sort', 'limit', 'offset'];
const project = (projectId) => `project=${encodeURIComponent(String(projectId))}`;
const pick = (q = {}, keys) => {
  const p = new URLSearchParams();
  for (const k of keys) if (q[k] != null && q[k] !== '') p.set(k, String(q[k]));
  const s = p.toString();
  return s ? `&${s}` : '';
};
const matchQuery = (q = {}) => pick(q, MATCH_KEYS);
const ACTIVITY_KEYS = ['q', 'kind', 'investor', 'page'];
export const capitalRelationshipsApi = {
  summary: (projectId, page = 1) => request(`/cycles/raise/capital-relationships/summary?${projectId == null ? '' : project(projectId)}&page=${encodeURIComponent(String(page))}`),
  supportRead: (projectId, reason, { page = 1, prospectId } = {}) => request(`/cycles/raise/capital-relationships/support-read?${project(projectId)}`, {
    method: 'POST', body: JSON.stringify({ reason, page, ...(prospectId == null ? {} : { prospect_id: prospectId }) }),
  }),
  supportReads: (projectId, page = 1) => request(`/cycles/raise/capital-relationships/support-reads?${project(projectId)}&page=${encodeURIComponent(String(page))}`),
  commitments: (projectId) => request(`/cycles/raise/capital-relationships/commitments?${project(projectId)}`),
  match: (projectId, q) => request(`/cycles/raise/capital-relationships/match?${project(projectId)}${matchQuery(q)}`),
  activity: (projectId, q = {}) => request(`/cycles/raise/capital-relationships/activity?${project(projectId)}${pick(q, ACTIVITY_KEYS)}`),
  materials: (projectId) => request(`/cycles/raise/capital-relationships/materials?${project(projectId)}`),
  proposals: (projectId) => request(`/cycles/raise/capital-relationships/proposals?${project(projectId)}`),
  proposeFromNote: (projectId, body) => request(`/cycles/raise/capital-relationships/proposals?${project(projectId)}`, { method: 'POST', body: JSON.stringify(body) }),
  acceptProposal: (projectId, uid, edited = null) => request(`/cycles/raise/capital-relationships/proposals/${encodeURIComponent(String(uid))}/accept?${project(projectId)}`, {
    method: 'POST', body: JSON.stringify(edited ? { edited } : {}),
  }),
  draft: (projectId, body) => request(`/cycles/raise/capital-relationships/drafts?${project(projectId)}`, { method: 'POST', body: JSON.stringify(body) }),
};
