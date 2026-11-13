import { request } from '../api.js';

/** #5314 part 1 (D4822): the client's side of a shared deliverable (client_deliverables.ts).
 * list(engagementId) -> { items: [{ uid, title, version, sent_at, has_link, opened_at, opened_version,
 *                        changed_since_open, signed_off_at }] } — only what the firm has sent
 * open(uid)          -> the same row plus { link_url, first_open }; records the client's FIRST open, once
 */
export const clientDeliverablesApi = {
  list: (engagementId) => request(`/client/deliverables/engagements/${encodeURIComponent(engagementId)}`),
  open: (uid) => request(`/client/deliverables/${encodeURIComponent(uid)}/open`, { method: 'POST' }),
};
