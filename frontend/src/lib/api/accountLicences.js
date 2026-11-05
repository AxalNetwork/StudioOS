/** D4472 (#4472): own licences and admin-only additional licence grants; no switcher or purchase. */
import { request } from '../api.js';

export const accountLicencesApi = {
  mine: () => request('/account/licences'),
  forAccount: (id) => request(`/admin/accounts/${encodeURIComponent(id)}/licences`),
  grant: (id, licence) => request(`/admin/accounts/${encodeURIComponent(id)}/licences`, { method: 'POST', body: JSON.stringify({ licence }) }),
  revoke: (id, licence) => request(`/admin/accounts/${encodeURIComponent(id)}/licences/${encodeURIComponent(licence)}`, { method: 'DELETE' }),
};
