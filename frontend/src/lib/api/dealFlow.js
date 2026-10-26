import { request } from '../api.js';

/** D1242 (#3255): Deal flow's Studio lens, for an admin or an Operating Partner (`deals.ts` `GET /studio`). */
export const dealFlowApi = {
  studio: () => request('/deals/studio'),
};
