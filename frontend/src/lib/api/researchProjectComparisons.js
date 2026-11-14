// D5157 part 3 (#5157) — a Research Project's companies and funds (Add to
// research from the directories) and its comparisons: read them, add or remove
// a company or a fund, and create, rename, delete and change a comparison.
// Worker: routes/research_project_comparisons.ts (`/api/research/projects/:uid/…`), owner-scoped.
import { request } from '../api.js';

const enc = encodeURIComponent;
const BASE = '/research/projects';
const send = (method, path, body) => request(`${BASE}${path}`, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });

export const researchProjectComparisonsApi = {
  /** `{ project, directory, attributes, limits, subjects, comparisons }` for one of your projects. */
  list: (uid) => request(`${BASE}/${enc(uid)}/comparisons`),
  /** `kind` is company or fund; `uids` are directory uids (at most 25). Kept once. */
  addSubjects: (uid, kind, uids) => send('POST', `/${enc(uid)}/subjects`, { kind, uids }),
  removeSubject: (uid, kind, directoryUid) => send('DELETE', `/${enc(uid)}/subjects/${enc(kind)}/${enc(directoryUid)}`),
  /** `{ kind, uids, title? }`: one kind, at most 6 columns; the title defaults to the names. */
  create: (uid, body) => send('POST', `/${enc(uid)}/comparisons`, body),
  rename: (uid, comparisonUid, title) => send('PATCH', `/${enc(uid)}/comparisons/${enc(comparisonUid)}`, { title }),
  remove: (uid, comparisonUid) => send('DELETE', `/${enc(uid)}/comparisons/${enc(comparisonUid)}`),
  addMember: (uid, comparisonUid, directoryUid) => send('POST', `/${enc(uid)}/comparisons/${enc(comparisonUid)}/members`, { uid: directoryUid }),
  removeMember: (uid, comparisonUid, directoryUid) => send('DELETE', `/${enc(uid)}/comparisons/${enc(comparisonUid)}/members/${enc(directoryUid)}`),
};
