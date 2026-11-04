import { request } from '../api.js';
/** D4490 — read plans and recorded spend. Never operates an ad account. */
export const growAdsApi = {
  read: (project, campaign) => request(`/grow/ads?${new URLSearchParams({ project: String(project), campaign })}`),
};
