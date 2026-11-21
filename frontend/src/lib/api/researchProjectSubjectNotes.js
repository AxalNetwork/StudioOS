// D7818 (#7818): owner-only Research Project subject notes with optimistic revisions.
import { request } from '../api.js';
const base = (uid) =>
  `/research/projects/${encodeURIComponent(uid)}/subject-notes`;
export const researchProjectSubjectNotesApi = {
  list: (uid) => request(base(uid)),
  /** expected_revision is 0 for a new note; omitted fields retain their saved values. A stale save returns 409. */
  save: (uid, kind, directoryUid, body) =>
    request(
      `${base(uid)}/${encodeURIComponent(kind)}/${encodeURIComponent(directoryUid)}`,
      { method: 'PUT', body: JSON.stringify(body) },
    ),
};
