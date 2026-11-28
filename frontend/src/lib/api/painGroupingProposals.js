/** D8546 (#9020): Problem discovery's proposed groupings — list, edit, discard and accept, on `/api/progress/pain-grouping-proposals`. */
import { request } from '../api.js';

// Every route is keyed by the venture and, for a decision, the proposal: GET /:projectId, PATCH /:projectId/:id,
// POST /:projectId/:id/discard and POST /:projectId/:id/accept. Venture writers only; anyone else is refused (403).
export const painGroupingProposalsApi = {
  // The venture's pending proposals: { proposals: [{ id, target_group_id, target_title, members: [{ phrase, sources }], edited, … }] }.
  list: (projectId) => request(`/progress/pain-grouping-proposals/${projectId}`),
  // { members?: [{ phrase, interview_id }], title? }; the original stays as proposed. Answers { proposal }.
  edit: (projectId, id, body) => request(`/progress/pain-grouping-proposals/${projectId}/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  // Status only; no theme or alias is written. Answers { proposal }.
  discard: (projectId, id) => request(`/progress/pain-grouping-proposals/${projectId}/${id}/discard`, { method: 'POST' }),
  // The whole set in one write. Answers { proposal, group_id, assigned }.
  accept: (projectId, id) => request(`/progress/pain-grouping-proposals/${projectId}/${id}/accept`, { method: 'POST' }),
};
