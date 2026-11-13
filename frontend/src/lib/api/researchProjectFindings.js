// D5157 part 2 (#5157) — a Research Project's findings client: list them, save
// a source fact or write a conclusion, edit or delete your conclusion, and
// accept, edit or discard an Eadwyn interpretation.
// Worker: routes/research_project_findings.ts (`/api/research/projects/:uid/…`), owner-scoped.
import { request } from '../api.js';

const enc = encodeURIComponent;
const BASE = '/research/projects';
const send = (method, path, body) => request(`${BASE}${path}`, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });

export const researchProjectFindingsApi = {
  /** `{ items, proposals, passages, evidence, counts }` for one of your projects. */
  list: (uid) => request(`${BASE}/${enc(uid)}/findings`),
  /**
   * `{ kind: 'source_fact' | 'conclusion', text, citations? }`. A citation is
   * `{ answer_uid, n }` (a passage the project's Ask answer recorded) or
   * `{ document_uid }` (a document in the project's evidence). A source fact
   * needs at least one passage.
   */
  create: (uid, body) => send('POST', `/${enc(uid)}/findings`, body),
  /** Your conclusion only: `{ text, citations? }`. */
  update: (uid, findingUid, body) => send('PATCH', `/${enc(uid)}/findings/${enc(findingUid)}`, body),
  /** A source fact or your conclusion; an interpretation is discarded instead. */
  remove: (uid, findingUid) => send('DELETE', `/${enc(uid)}/findings/${enc(findingUid)}`),
  /** `decision` is accept, edit (with `text`) or discard. */
  decide: (uid, answerUid, decision, text) => send('POST', `/${enc(uid)}/interpretations/${enc(answerUid)}`, decision === 'edit' ? { decision, text } : { decision }),
};
