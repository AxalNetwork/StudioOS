/** D7845 (#7845): one atomic private-dossier save and request-id reconciliation; the caller retains the same id on retry. */
import { request } from '../api.js';
export const researchFundShortlistApi = {
  save: ({ catalogue_ids, request_id }) => request('/research/fund-shortlist', {
    method: 'POST', body: JSON.stringify({ catalogue_ids, request_id }),
  }),
  getSave: requestId => request(`/research/fund-shortlist/requests/${encodeURIComponent(requestId)}`),
};
