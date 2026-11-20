// D6863 (#6863, canvas D6053): a Call for Capital's follow-through (`/api/round-calls/:uid/…`): the read, Remind, the CSV and PDF exports, a new call from a closed one, and a response recorded as Signed or Wired.
import { request } from '../api.js';
import { api } from '../api.js';

const at = (uid) => `/round-calls/${encodeURIComponent(uid)}`;
export const roundCallFollowThroughApi = {
  read: (uid) => request(`${at(uid)}/follow-through`),
  // Owner only. At most 2 per recipient per call, 3 days apart: the Worker refuses the rest and says why.
  remind: (uid, recipientIds) => request(`${at(uid)}/remind`, { method: 'POST', body: JSON.stringify({ recipient_ids: recipientIds }) }),
  // Owner only. `scope` is 'responses' or 'terms'; each export is logged on the call before the file is answered.
  exportCsv: (uid, scope = 'responses') => api._downloadCsv(`${at(uid)}/export.csv?scope=${encodeURIComponent(scope)}`, 'call-responses.csv'),
  exportPdf: (uid, scope = 'responses') => api._downloadCsv(`${at(uid)}/export.pdf?scope=${encodeURIComponent(scope)}`, 'call-responses.pdf'),
  // D7513 (RAC20C): step 3 of a draft started from a closed call — that call's chosen recipients, ticked when still verified.
  sourceAudience: (uid) => request(`${at(uid)}/source-audience`),
  startFromClosed: (uid, body) => request(`${at(uid)}/successor`, { method: 'POST', body: JSON.stringify(body) }),
  recordCommitment: (uid, body) => request(`${at(uid)}/commitments`, { method: 'POST', body: JSON.stringify(body) }),
};
