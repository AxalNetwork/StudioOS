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
  /** D948 (#2753): SL3, one application — D944's row, what the founder was told,
   * the latest interview, its cohort and the next one, and the Week 1 plan, each alone. 404 when none. */
  application: (applicantId) => request(`/admin/cohort/applications/${encodeURIComponent(applicantId)}`),
  /** D946 (#2751): SL7's participants, filtered, sorted and paged by the Worker.
   * {cohort,status,week,this_week,incorporated,needs,q,sort,limit,offset} -> page, total, standing. */
  participants: (params = {}) => {
    const { cohort, status, week, this_week, incorporated, needs, q, sort, limit, offset } = params;
    return request(`/admin/cohort/participants${query({ cohort, status, week, this_week, incorporated, needs: needs ? 1 : undefined, q, sort, limit, offset })}`);
  },
  /** D946: SL8's drawer — one participant's row, weeks, tools, open case and history. */
  participant: (uid) => request(`/admin/cohort/participants/${encodeURIComponent(uid)}`),
  /** D946: SL14s, the Super Admin's read of support sessions (every admin's). 403 for an Admin. */
  supportSessions: () => request('/admin/cohort/impersonation-audit'),
  /** D945 (#2750): SL4 D — an undecided, waitlisted or approved applicant to
   * another open cohort, with a reason. The founder is told. */
  move: (applicantId, { cycle_id, reason, confirm_over_places } = {}) =>
    request(`/admin/cohort/applications/${encodeURIComponent(applicantId)}/move`, {
      method: 'POST', body: JSON.stringify({ cycle_id, reason, confirm_over_places }),
    }),
  /** D945: SL2's bulk bar — approve or waitlist up to 25 applicants with one
   * reason, each through the one decision path. Answers each applicant's result. */
  bulkDecide: ({ applicant_ids, status, reason, confirm_over_places } = {}) =>
    request('/admin/cohort/applications/bulk-decide', {
      method: 'POST', body: JSON.stringify({ applicant_ids, status, reason, confirm_over_places }),
    }),
  /** D945: SL4 G — admit a founder without an application, into an open cohort. */
  admit: ({ user_id, cycle_id, reason, company_name, confirm_over_places } = {}) =>
    request('/admin/cohort/applications/admit', {
      method: 'POST', body: JSON.stringify({ user_id, cycle_id, reason, company_name, confirm_over_places }),
    }),
};
