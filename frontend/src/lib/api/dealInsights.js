import { request } from '../api.js';

/** D1151: published/shared deal sections; preserves masked and unreadable states. */
export const dealInsightsApi = {
  team: (id) => request(`/deals/${encodeURIComponent(id)}/team`),
  market: (id) => request(`/deals/${encodeURIComponent(id)}/market`),
  traction: (id) => request(`/deals/${encodeURIComponent(id)}/traction`),
};
