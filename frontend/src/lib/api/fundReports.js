/** D631: a fund's page and one issued reporting period (`/api/funds/:id/page`, `/report-periods/:id`), ids checked before any request. */
import { request } from '../api.js';

const id = (value) => {
  if (!/^[1-9][0-9]*$/.test(String(value)) || !Number.isSafeInteger(Number(value))) throw new Error('Choose a recorded fund or reporting period.');
  return String(value);
};
export const fundReportsApi = {
  fund: (fundId) => request(`/funds/${id(fundId)}/page`),
  period: (fundId, periodId) => request(`/funds/${id(fundId)}/report-periods/${id(periodId)}`),
};
