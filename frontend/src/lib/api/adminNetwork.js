// D973 / #2759: read-only Advisors & Partners contracts.
import { request } from '../api.js';
const query = (filters) => {
  const params = new URLSearchParams();
  for (const key of ['q', 'kind', 'stage', 'skill', 'sector', 'lab_host', 'profile_check', 'kyc', 'on_deck', 'firm_attached', 'active_deal', 'sort', 'limit', 'offset']) {
    const value = filters?.[key];
    if (value !== undefined && value !== null && value !== '') params.set(key, String(value));
  }
  return params.size ? `?${params}` : '';
};
export const adminNetworkApi = {
  overview: () => request('/admin/network/overview'),
  people: (filters = {}) => request(`/admin/network/people${query(filters)}`),
  person: (ref) => request(`/admin/network/people/${encodeURIComponent(ref)}`),
};
