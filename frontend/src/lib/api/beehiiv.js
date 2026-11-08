// D2407 (#2407 parts 1–2) — a founder's own Beehiiv in Grow: the one
// publication each venture reads, the founder-pressed sync, the channel
// proposal and deleting a figure. Worker: routes/cycle_grow.ts (`/beehiiv/…`).
// The module reads themselves carry `parts.from_beehiiv` (Distribution,
// Revenue and traction). Read only: nothing here writes to Beehiiv.
import { request } from '../api.js';

const enc = encodeURIComponent;
const BASE = '/cycles/grow/beehiiv';
const post = (path, body) => request(`${BASE}${path}`, { method: 'POST', body: JSON.stringify(body) });

export const beehiivApi = {
  /** The caller's own publications, the venture's link, or the teammate whose Beehiiv serves it. */
  publications: (projectId) => request(`${BASE}/publications?project=${enc(projectId)}`),
  /** Link the venture to one publication; `null` unlinks it. */
  setPublication: (projectId, publicationId) => request(`${BASE}/publication`, { method: 'PUT', body: JSON.stringify({ project: projectId, publication_id: publicationId }) }),
  /** One sync, pressed by the member whose Beehiiv serves the venture: counts only. */
  sync: (projectId) => post('/sync', { project: projectId }),
  /** Accept the channel proposal: link `growth_channel_uid`, or create one with `utm_source`. */
  acceptChannel: (projectId, extra = {}) => post('/channel-proposal/accept', { ...extra, project: projectId }),
  dismissChannel: (projectId) => post('/channel-proposal/dismiss', { project: projectId }),
  /** Delete a figure or a post's figures; the next sync leaves it deleted. */
  deleteFact: (projectId, id) => request(`${BASE}/facts/${enc(id)}?project=${enc(projectId)}`, { method: 'DELETE' }),
  deletePost: (projectId, id) => request(`${BASE}/posts/${enc(id)}?project=${enc(projectId)}`, { method: 'DELETE' }),
};
