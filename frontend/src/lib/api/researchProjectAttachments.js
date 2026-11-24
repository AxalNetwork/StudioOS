// D7817 (#7817) — a Research Project's attachments client: attach a saved
// analysis version as a frozen copy, list the project's attachments (without
// the copy's body), read one with its copy, detach one, and take a generated
// finding of a copy over as an Eadwyn interpretation.
// Worker: routes/research_project_attachments.ts (`/api/research/projects/:uid/attachments…`)
// and routes/research_project_findings.ts (the taken-over finding), owner-scoped.
import { request } from '../api.js';

const enc = encodeURIComponent;
const BASE = '/research/projects';
const send = (method, path, body) => request(`${BASE}${path}`, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });

export const researchProjectAttachmentsApi = {
  /** `{ items, limit, kinds }`: each item names what was attached and when, never the copy. */
  list: (uid) => request(`${BASE}/${enc(uid)}/attachments`),
  /**
   * `{ kind: 'competitor_analysis', object_id, version }`. A repeat of the same
   * analysis and version answers the attachment on record (`created: false`).
   */
  attach: (uid, body) => send('POST', `/${enc(uid)}/attachments`, body),
  /** One attachment with its frozen copy. */
  get: (uid, attachmentUid) => request(`${BASE}/${enc(uid)}/attachments/${enc(attachmentUid)}`),
  /** Findings and their frozen citations stay; they read as attachment removed. */
  detach: (uid, attachmentUid) => send('DELETE', `/${enc(uid)}/attachments/${enc(attachmentUid)}`),
  /** A generated finding `n` of the copy, as an interpretation: accept, edit (with `text`) or discard. */
  decide: (uid, attachmentUid, n, decision, text) => send('POST', `/${enc(uid)}/interpretations/attachments/${enc(attachmentUid)}/${enc(n)}`, decision === 'edit' ? { decision, text } : { decision }),
};
