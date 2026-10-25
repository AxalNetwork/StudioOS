import { request } from '../api.js';

/** D1136 (#3016): Account › Companies and projects, the caller's own reads (account_companies.ts).
 * companies()   -> { companies: [{ uid, company_name, stage, logo_url, my_role, title, authority, is_primary_admin,
 *                    member_count, cycles_active, last_opened, pending_invitations (editors only), counts }] }
 * projects()    -> { projects: [{ id, uid, name, my_seat, company_id, company_uid, company_name, stage, playbook_week,
 *                    member_count, cycles_active }] } — owned or seated, never every venture
 * invitations() -> { company, project }, each a block of pending invitations addressed to the caller
 * Every figure is a block, `{ available: true, value }` or `{ available: false, reason }`: never a zero for a failed read.
 */
export const accountCompaniesApi = {
  companies: () => request('/account/companies'),
  projects: () => request('/account/projects'),
  invitations: () => request('/account/invitations'),
  acceptCompanyInvitation: (uid) => request(`/company/invitations/${encodeURIComponent(uid)}/accept`, { method: 'POST' }),
  acceptProjectInvitation: (id) => request(`/projects/invitations/${encodeURIComponent(id)}/accept`, { method: 'POST' }),
  declineProjectInvitation: (id) => request(`/projects/invitations/${encodeURIComponent(id)}/decline`, { method: 'POST' }),
};
