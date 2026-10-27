import { request } from '../api.js';

// D1238 (#3251, part 2 of #2423) — an investor firm's own deal flow, on
// cloudflare-worker/src/routes/deal_flow.ts at /api/deals/flow (migration 618).
//   flow()                         GET   /deals/flow → { scope, items, by_stage }
//   add(body)                      POST  /deals/flow { deal_id, stage?, owner_user_id?, via_key? } → 201 row
//   update(dealId, body)           PATCH /deals/flow/:dealId { stage?, owner_user_id?, note? } → row
//   pass(dealId, body)             POST  /deals/flow/:dealId/pass { reason, revisit?, revisit_at?, note?, via_key? } → row
//   events(dealId)                 GET   /deals/flow/:dealId/events → { items }
//   inbox()                        GET   /deals/flow/inbox → { items, sources }
//   dismiss(key, reason?)          POST  /deals/flow/inbox/:key/dismiss { reason? } → { ok, key }
// D1241 (#3254): Compare's Eadwyn note, drafted from SCORING's bands and saved only on press.
//   compareNotes(ids)              GET   /deals/flow/compare-note?ids= → { items, unreadable }
//   draftCompareNote(ids)          POST  /deals/flow/compare-note { deal_ids } → { note, receipt }
//   keepCompareNote(receipt)       POST  /deals/flow/compare-note/keep { receipt } → { saved }
// A pass is the investor's alone and never closes the round; Closing follows a commitment.
const id = (v) => encodeURIComponent(String(v));
export const dealFlowApi = {
  studio: () => request('/deals/studio'),
  flow: () => request('/deals/flow'),
  add: (body) => request('/deals/flow', { method: 'POST', body: JSON.stringify(body) }),
  update: (dealId, body) => request(`/deals/flow/${id(dealId)}`, { method: 'PATCH', body: JSON.stringify(body) }),
  pass: (dealId, body) => request(`/deals/flow/${id(dealId)}/pass`, { method: 'POST', body: JSON.stringify(body) }),
  events: (dealId) => request(`/deals/flow/${id(dealId)}/events`),
  inbox: () => request('/deals/flow/inbox'),
  compareNotes: (ids) => request(`/deals/flow/compare-note?ids=${ids.map(id).join(',')}`),
  draftCompareNote: (ids) => request('/deals/flow/compare-note', { method: 'POST', body: JSON.stringify({ deal_ids: ids }) }),
  keepCompareNote: (receipt) => request('/deals/flow/compare-note/keep', { method: 'POST', body: JSON.stringify({ receipt }) }),
  dismiss: (key, reason) => request(`/deals/flow/inbox/${id(key)}/dismiss`, { method: 'POST', body: JSON.stringify({ reason: reason || null }) }),
};
