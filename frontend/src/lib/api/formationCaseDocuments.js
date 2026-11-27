// D6706 (#6706, E14 of #6680) — a formation case's documents, the founder's
// side: the Worker's routes/formation_case_documents.ts at
// /api/formation/cases/:uid/documents. The documents the founder may see (each
// with its SHA-256 and signing state), the form's template set as it stands,
// one document's text, and sending one for signature through the in-house
// e-sign. No screen uses this yet.
import { request } from '../api.js';

const enc = encodeURIComponent;

export const formationCaseDocumentsApi = {
  /** → {case_uid, documents: [{uid, class, origin, template_key, title, sha256, person, signing, …}], plan} */
  list: (caseUid) => request(`/formation/cases/${enc(caseUid)}/documents`),
  /** One document → {document: {uid, title, sha256, body, …}} */
  get: (caseUid, docUid) => request(`/formation/cases/${enc(caseUid)}/documents/${enc(docUid)}`),
  /** {document_uid | template_key, person_uid?, purpose?: 'document' | 'consent_to_act'} → {envelope_uuid, email_sent, …} */
  sign: (caseUid, body) => request(`/formation/cases/${enc(caseUid)}/documents/sign`, { method: 'POST', body: JSON.stringify(body ?? {}) }),
};
