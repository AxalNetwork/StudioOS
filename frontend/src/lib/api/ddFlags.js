import { request } from '../api.js';

// D1247 (#3262, part 3 of #2385) — a Due Diligence flag raised by hand, given
// an owner, worked through a state and closed with a resolution. Worker:
// routes/dd.ts, migration 621. The case read (`GET /dd/cases/:uid`) carries
// each finding's new fields and a `flags` list that adds flagged or failed
// checklist items (source 'checklist'). No page draws these yet.
//
//   raise    POST  /dd/cases/:uid/findings                { section_id, severity, title, detail?, owner_user_id?, checklist_item_id? } → 201 { finding, score, band }
//   change   PATCH /dd/cases/:uid/findings/:id            { owner_user_id?, state?, resolution? } → { finding, score, band };
//                                                          400 resolution_required to accept or close without one; 409 finding_changed
//   history  GET   /dd/cases/:uid/findings/:id/history    → { items: [{ id, action, at, actor_user_id, actor_name, details }] }
//
// Every path is written out in full so the drift check reads each one against the Worker.
const enc = encodeURIComponent;

export const DD_FLAG_STATES = ['open', 'in_progress', 'condition_to_close', 'accepted', 'closed'];

export const ddFlagsApi = {
  raise: (uid, flag) => request(`/dd/cases/${enc(uid)}/findings`, { method: 'POST', body: JSON.stringify(flag) }),
  change: (uid, id, changes) => {
    if (changes?.state !== undefined && !DD_FLAG_STATES.includes(changes.state)) throw new Error(`Unknown flag state: ${changes.state}`);
    return request(`/dd/cases/${enc(uid)}/findings/${enc(id)}`, { method: 'PATCH', body: JSON.stringify(changes) });
  },
  history: (uid, id) => request(`/dd/cases/${enc(uid)}/findings/${enc(id)}/history`),
};
