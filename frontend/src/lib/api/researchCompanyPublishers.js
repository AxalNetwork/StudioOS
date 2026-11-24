// D7810 (#7810): Companies-gated publisher references and provenance inventory; counts include all stored rows.
import { request } from '../api.js';
export const researchCompanyPublishersApi = {
  list: () => request('/research/company-publishers'),
};
