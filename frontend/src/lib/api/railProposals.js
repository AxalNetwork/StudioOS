// D780 (#2105) — the member's own drafts, proposals and notes from a rail
// option's run, and their press on each (D720 §9: "Eadwyn drafts; you send").
// Worker: routes/ai_rail_proposals.ts, migration 506's `ai_rail_proposals`. Caller only.
//   GET  /api/ai/rail/proposals?option=<key>[&record=<type:id>][&status=<status>]
//                                              → { proposals: [{ uid, rail_option, record_ref, kind,
//                                                  payload, model, usage_log_id, status, … }] }
//   POST /api/ai/rail/proposals/:uid/decide    { decision: 'accept'|'edit'|'discard', payload? }
//                                              → { proposal }; 409 not_open when it is not the
//                                                caller's or was already decided
// Deciding writes no record: the page's own Save does.
import { request } from '../api.js';

const enc = encodeURIComponent;

export const railProposalsApi = {
  list: ({ option, record, status } = {}) => {
    const q = new URLSearchParams({ option: String(option || '') });
    if (record) q.set('record', record);
    if (status) q.set('status', status);
    return request(`/ai/rail/proposals?${q}`);
  },
  decide: (uid, decision, payload) => request(`/ai/rail/proposals/${enc(uid)}/decide`, {
    method: 'POST', body: JSON.stringify(payload ? { decision, payload } : { decision }),
  }),
};
