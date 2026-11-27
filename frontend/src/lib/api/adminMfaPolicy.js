// D5249 (#5249): HQ's "Require MFA for admins" setting — Super Admin read and change, reason required.
import { request } from '../api.js';
export const adminMfaPolicyApi = {
  get: () => request('/admin/security/mfa-policy'),
  set: (enabled, reason) => request('/admin/security/mfa-policy', {
    method: 'PUT', body: JSON.stringify({ enabled: enabled === true, reason }),
  }),
};
