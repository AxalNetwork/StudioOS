// D5157 (#5157) — the Research Project client: My Research's list, create, the
// workspace read, edits, archive and restore, and the evidence and Ask links.
// Worker: routes/research_projects.ts (`/api/research/projects`), owner-scoped.
import { request } from '../api.js';

const enc = encodeURIComponent;
const BASE = '/research/projects';
const send = (method, path, body) => request(`${BASE}${path}`, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });

/** The link kinds the Worker accepts, and the body field each one names. */
export const PROJECT_LINKS = {
  documents: 'document_uid',
  collections: 'collection_uid',
  sessions: 'session_uid',
  answers: 'answer_uid',
};

export const researchProjectsApi = {
  /** `status`: active (default), archived or all. */
  list: (status = 'active') => request(`${BASE}?status=${enc(status)}`),
  /** `{ question, title?, objective?, scope?, exclusions? }`; the title defaults to the question. */
  create: (body) => send('POST', '', body),
  read: (uid) => request(`${BASE}/${enc(uid)}`),
  /** Any of title, question, objective, scope, exclusions (null clears), status in_progress | complete. */
  update: (uid, body) => send('PATCH', `/${enc(uid)}`, body),
  archive: (uid) => send('POST', `/${enc(uid)}/archive`),
  restore: (uid) => send('POST', `/${enc(uid)}/restore`),
  /** `kind` is a key of PROJECT_LINKS. */
  link: (uid, kind, targetUid) => send('POST', `/${enc(uid)}/${kind}`, { [PROJECT_LINKS[kind]]: targetUid }),
  unlink: (uid, kind, targetUid) => send('DELETE', `/${enc(uid)}/${kind}/${enc(targetUid)}`),
};
