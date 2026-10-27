// D1325 (#3486, #2431 part 2) — the Fill with Eadwyn sheet's read. Worker:
// routes/fills.ts. No model runs and nothing is written by the read.
// D1326 (#3487, part 3) — the writes, each the member's own press:
//   record      after the form's own Save: keeps only the fields that still equal what was proposed
//   acceptRows  Accept all for row proposals, at most 50, each outcome reported
//   undo        puts back what one fill replaced, only while the field holds it
// The run itself is `POST /api/ai/rail/run` (routes/rail_run.ts), a stream part 4 reads.
import { request } from '../api.js';

const enc = encodeURIComponent;

export const fillsApi = {
  /** `{ page, form, project, record? }` → each field's value, mark, waiting values and trigger, the sources and Eadwyn's quote. */
  sheet: ({ page, form, project, record = null }) => request(
    `/fills/sheet?page=${enc(page)}&form=${enc(form)}&project=${enc(project)}${record != null ? `&record=${enc(record)}` : ''}`,
  ),
  /** `{ page, form, project, record, proposals: [uid] }` → `{ record, outcomes: [{ uid, field, outcome, why?, provenance_id? }] }`. */
  record: (body) => request('/fills/record', { method: 'POST', body: JSON.stringify(body) }),
  /** `{ page, form, project, proposals: [uid] }` → `{ outcomes: [{ uid, outcome, id?, why? }], over_limit: [uid] }`. */
  acceptRows: (body) => request('/fills/rows/accept', { method: 'POST', body: JSON.stringify(body) }),
  /** One fill's id → `{ ok, id, value }`; 409 `edited` when the field changed since. */
  undo: (id) => request(`/fills/${enc(id)}/undo`, { method: 'POST', body: JSON.stringify({}) }),
};
