/**
 * D4472 (#4472): own licences and admin-only additional licence grants; no switcher or purchase.
 * D4729 (#4729): each `held[]` entry also carries `plan: { key, name } | null`, the plan that licence stands on
 * (its `:free` entry when granted with no plan of its own). `null` means no plan is recorded: draw "Not recorded", never 0.
 */
import { request } from '../api.js';

export const accountLicencesApi = {
  mine: () => request('/account/licences'),
  forAccount: (id) => request(`/admin/accounts/${encodeURIComponent(id)}/licences`),
  grant: (id, licence) => request(`/admin/accounts/${encodeURIComponent(id)}/licences`, { method: 'POST', body: JSON.stringify({ licence }) }),
  revoke: (id, licence) => request(`/admin/accounts/${encodeURIComponent(id)}/licences/${encodeURIComponent(licence)}`, { method: 'DELETE' }),
};
