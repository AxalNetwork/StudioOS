/** D9025 (#9025): the shared Network directory's member reads, the caller's own private overlay and (D9071) organization people counts (`/api/network/directory`, D7674). */
import { request } from '../api.js';

/** `{ q, kind, cursor, limit }` as a query string; an empty value is left out, so the Worker applies its own default. */
function directoryQuery(params = {}) {
  const out = new URLSearchParams();
  for (const key of ['q', 'kind', 'cursor', 'limit']) {
    const v = params[key];
    if (v !== undefined && v !== null && String(v).trim() !== '') out.set(key, String(v).trim());
  }
  const s = out.toString();
  return s ? `?${s}` : '';
}

export const networkDirectoryApi = {
  /** One page of published entries and the true total under the same filter: `{ entries, total, next_cursor }`. */
  entries: (params) => request(`/network/directory/entries${directoryQuery(params)}`),
  /** One published entry and its sourced associations: `{ entry, affiliations }`. */
  entry: (uid) => request(`/network/directory/entries/${encodeURIComponent(uid)}`),
  /** The caller's own overlay on a person: `{ overlay: { saved, private_note, updated_at } | null }`. */
  overlay: (uid) => request(`/network/directory/entries/${encodeURIComponent(uid)}/overlay`),
  /** Writes only the caller's own row; send `saved`, `private_note` or both. */
  saveOverlay: (uid, body) => request(`/network/directory/entries/${encodeURIComponent(uid)}/overlay`, { method: 'PUT', body: JSON.stringify(body) }),
  /**
   * D9071 (#9071): distinct published people per organization, by affiliation status, for up to 50 organizations:
   * `{ counts: { [uid]: { people, current, former, unknown } } }`; a uid that is not a visible organization is absent.
   */
  peopleCounts: (uids) => request(`/network/directory/organizations/people-counts?uids=${encodeURIComponent((uids || []).join(','))}`),
  /** Removes the caller's own overlay on this person. */
  clearOverlay: (uid) => request(`/network/directory/entries/${encodeURIComponent(uid)}/overlay`, { method: 'DELETE' }),
};

export { directoryQuery };
