import { request } from '../api.js';

export const advisorServicesApi = {
  setPublication: (id, publicationState, revision) => request(
    `/advisors/me/services/${encodeURIComponent(id)}`,
    { method: 'PATCH', body: JSON.stringify({ publication_state: publicationState, revision }) },
  ),
};
