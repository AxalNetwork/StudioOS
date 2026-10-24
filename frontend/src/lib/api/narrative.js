import { request } from '../api.js';

// D910 (#2694) — the Investor narrative's own stores (D908, #2692), on
// routes/cycle_raise.ts behind scope() (`?project=`; the venture's founder or
// an admin writes). Version 0 is the live deck: it reads, and a write is 409.
//   read         GET /cycles/raise/narrative/:version
//                → { version, meta, sections: { state, items }, positioning, bindings: { state, items } }
//   saveSection  PUT /cycles/raise/narrative/:version/sections/:section
//                { body?, audience_note?, position?, source?, bindings? } — at least one
// Each write logs one raise.investor-narrative row, never the words or a figure.
const enc = encodeURIComponent;

export const narrativeApi = {
  read: (projectId, version) => request(`/cycles/raise/narrative/${enc(version)}?project=${enc(projectId)}`),
  saveSection: (projectId, version, section, body) => request(`/cycles/raise/narrative/${enc(version)}/sections/${enc(section)}?project=${enc(projectId)}`, {
    method: 'PUT', body: JSON.stringify(body),
  }),
};
