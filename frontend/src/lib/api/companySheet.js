import { request } from '../api.js';

export const companySheetApi = {
  recordVisit: (companyId, cycle) => request('/company/visits', {
    method: 'PUT', body: JSON.stringify({ company_id: companyId, cycle }),
  }),
};
