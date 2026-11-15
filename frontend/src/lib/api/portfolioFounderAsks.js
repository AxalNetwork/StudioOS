import { request } from '../api.js';

export const portfolioFounderAsksApi = {
  list: (updateUid) => request(`/portfolio-updates/${encodeURIComponent(updateUid)}/asks`),
};
