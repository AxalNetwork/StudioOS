import { request } from '../api.js';

/** D979 (#2765): Advisors & Partners › Firms, /api/admin/partners/firms (admin_partner_firms.ts). Read only.
 * List: {q,directory,deal_type,ends_within,no_accounts,sort,limit,offset} -> {items,total,limit,offset,sort,filters,unreadable}.
 * One firm: id -> {firm,accounts,directory,deals,settlements,profiles,office_hours}, each block alone (D973's shape).
 * The writes are the existing directory switch (`adminSetPartnerDirectory`) and firm link (`adminPartners.setFirmLink`).
 */
function query(params = {}) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '' && v !== false) q.set(k, String(v));
  return q.size ? `?${q}` : '';
}
export const adminPartnerFirmsApi = {
  list: (params = {}) => {
    const { q, directory, deal_type, ends_within, no_accounts, sort, limit, offset } = params;
    return request(`/admin/partners/firms${query({ q, directory, deal_type, ends_within, no_accounts, sort, limit, offset })}`);
  },
  get: (id) => request(`/admin/partners/firms/${encodeURIComponent(id)}`),
};
