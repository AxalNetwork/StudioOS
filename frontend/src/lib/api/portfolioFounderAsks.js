// D6216 (#6216): read founder asks scoped to the recipient of an investor report.
import { request } from '../api.js';

export const portfolioFounderAsksApi = {
  list: (updateUid) => request(`/portfolio-updates/${encodeURIComponent(updateUid)}/asks`),
};
