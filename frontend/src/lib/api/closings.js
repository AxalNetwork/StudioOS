// D1215 (#3212, part 2 of #2424) — closings as a record. Worker:
// routes/closings.ts, at /api/closings and /api/admin/closings.
//
// Reads answer what the caller may see: an admin or the venture's founder
// every line; an investor their own lines and the round's total. Writes are an
// Admin's, except the cap-table decision, which is the founder's. Amounts are
// integer cents with the closing's currency. Nothing here moves money.
import { request } from '../api.js';

const at = (uid) => `/closings/${encodeURIComponent(uid)}`;
const line = (uid, lineUid) => `${at(uid)}/lines/${encodeURIComponent(lineUid)}`;
const post = (path, body = {}) => request(path, { method: 'POST', body: JSON.stringify(body) });

export const closingsApi = {
  list: () => request('/closings'),
  read: (uid) => request(at(uid)),
  /** {deal_id, round_label?, instrument?, template_slug?, deadline?, owner_user_id?} */
  open: (body) => post('/closings', body),
  /** {commitment_uid} or {prospect_id} */
  addLine: (uid, body) => post(`${at(uid)}/lines`, body),
  setRoute: (uid, lineUid, route, vehicleRef) =>
    request(`${line(uid, lineUid)}/route`, { method: 'PUT', body: JSON.stringify({ route, vehicle_ref: vehicleRef || undefined }) }),
  withdrawLine: (uid, lineUid) => post(`${line(uid, lineUid)}/withdraw`),
  /** {kind, source_ref}: the source names a stored record by its id (mercury:<id>, deal_transfer:<uid>, file:<key>). */
  addEvidence: (uid, lineUid, body) => post(`${line(uid, lineUid)}/evidence`, body),
  withdrawEvidence: (uid, evidenceUid, reason) => post(`${at(uid)}/evidence/${encodeURIComponent(evidenceUid)}/withdraw`, { reason }),
  acceptCaptable: (uid) => post(`${at(uid)}/captable/accept`),
  dismissCaptable: (uid) => post(`${at(uid)}/captable/dismiss`),
  complete: (uid) => post(`${at(uid)}/complete`),
  /** The admin desk: every open closing with its lines waiting, next actor and owner. */
  desk: () => request('/admin/closings'),
};

// D1219 (#3216, part 6 of #2424) — D1216's paper signed in order, with Axal's
// countersign last. Worker: routes/esign.ts, under /api/legal/esign/staged.
const staged = (path = '') => `/legal/esign/staged${path}`;

export const stagedSigningApi = {
  /** {document_type, fields?, title?}: the text a stage would sign, and the fields left open. */
  preview: (body) => post(staged('/preview'), body),
  /** {deal_id, commitment_id?, document_type, title?, fields, signers: [{role, user_id}], countersign?} */
  start: (body) => post(staged(), body),
  /** Every staged envelope on one closing line, by its commitment id. */
  line: (commitmentId) => request(staged(`/line/${encodeURIComponent(commitmentId)}`)),
  read: (uid) => request(staged(`/${encodeURIComponent(uid)}`)),
  /** closing.countersign: a Super Admin, with a fresh step-up (the request helper asks for it). */
  countersign: (uid) => post(staged(`/${encodeURIComponent(uid)}/countersign`)),
};
