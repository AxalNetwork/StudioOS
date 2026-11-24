// D7828 (#7828): a company's sourced business facts and its per-job completeness, behind the Companies rule.
import { request } from '../api.js';
export const researchCompanyFactsApi = {
  facts: (uid) => request(`/research/company-directory/${encodeURIComponent(uid)}/facts`),
  completeness: (uid) => request(`/research/company-directory/${encodeURIComponent(uid)}/completeness`),
};
