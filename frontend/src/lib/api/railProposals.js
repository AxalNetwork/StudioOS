// D780 (#2105) — the member's own drafts, proposals and notes from a rail
// option's run, and their press on each (D720 §9: "Eadwyn drafts; you send").
// Worker: routes/ai_rail_proposals.ts, migration 506's `ai_rail_proposals`. Caller only.
//   GET  /api/ai/rail/proposals?option=<key>[&record=<type:id>][&status=<status>]
//                                              → { proposals: [{ uid, rail_option, record_ref, kind,
//                                                  payload, model, usage_log_id, status, … }] }
//   POST /api/ai/rail/proposals/:uid/decide    { decision: 'accept'|'edit'|'discard', payload? }
//                                              → { proposal }; 409 not_open when it is not the
//                                                caller's or was already decided; 422 never_fill
//                                                when the value kept is for a field Eadwyn never fills
// Deciding writes no record: the page's own Save does.
//
// D777 part 3: a placement is decided one at a time, by its own uid; there is no
// bulk decide. An edit that names a field Eadwyn never fills is refused here,
// before it is sent, with the registry's sentence; the Worker refuses it too,
// and also refuses keeping a stored proposal whose field the client cannot see.
import { request } from '../api.js';
import { neverFillMessage, neverFillReason } from '../neverFill.js';

const enc = encodeURIComponent;

/** The error a never-fill refusal throws, shaped as `request` shapes the Worker's 422. */
function neverFillRefusal(field) {
  const e = new Error(neverFillMessage(field));
  e.status = 422;
  e.code = 'never_fill';
  e.data = { refusal: 'never_fill', field, discarded: false };
  return e;
}

export const railProposalsApi = {
  list: ({ option, record, status } = {}) => {
    const q = new URLSearchParams({ option: String(option || '') });
    if (record) q.set('record', record);
    if (status) q.set('status', status);
    return request(`/ai/rail/proposals?${q}`);
  },
  decide: (uid, decision, payload) => {
    const field = decision !== 'discard' ? payload?.field : undefined;
    if (typeof field === 'string' && neverFillReason(field)) return Promise.reject(neverFillRefusal(field));
    return request(`/ai/rail/proposals/${enc(uid)}/decide`, {
      method: 'POST', body: JSON.stringify(payload ? { decision, payload } : { decision }),
    });
  },
};
