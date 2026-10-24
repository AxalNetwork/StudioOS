import { request } from '../api.js';

/** D944 (#2749): read-only admin Lab data, /api/admin/cohort (admin_lab.ts).
 * Overview: {cohort?:'YYYY-MM'} -> independently available blocks.
 * Applications: {cohort,status,origin,tech_transfer,stage,incorporated,
 * interview,carried_forward,sort,q,limit,offset} -> available page and total.
 * See D944 for enums, count attribution and missing-data states.
 */
function query(params = {}) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') q.set(k, String(v));
  return q.size ? `?${q}` : '';
}
export const adminLabApi = {
  overview: ({ cohort } = {}) => request(`/admin/cohort/overview${query({ cohort })}`),
  applications: (params = {}) => {
    const { cohort, status, origin, tech_transfer, stage, incorporated, interview, carried_forward, sort, q, limit, offset } = params;
    return request(`/admin/cohort/applications/list${query({ cohort, status, origin, tech_transfer, stage, incorporated, interview, carried_forward, sort, q, limit, offset })}`);
  },
};
