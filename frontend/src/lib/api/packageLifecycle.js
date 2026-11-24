/** HQ package term states, change review and next-term change schedule clients; Worker routes/admin_package_lifecycle.ts (#5025). */
import { request } from '../api.js';
const enc = encodeURIComponent;
export const packageLifecycleApi = {
  terms: (licenceUid) => request(`/admin/licences/${enc(licenceUid)}/package-terms`),
  changeReview: (licenceUid, offerUid, effectiveOn) => request(
    `/admin/licences/${enc(licenceUid)}/package-offers/${enc(offerUid)}/change-review${effectiveOn ? `?effective_on=${enc(effectiveOn)}` : ''}`),
  changes: (licenceUid) => request(`/admin/licences/${enc(licenceUid)}/package-changes`),
  scheduleChange: (licenceUid, offerUid, body) => request(`/admin/licences/${enc(licenceUid)}/package-offers/${enc(offerUid)}/schedule-change`,
    { method: 'POST', body: JSON.stringify(body) }),
  cancelChange: (licenceUid, changeUid, body) => request(`/admin/licences/${enc(licenceUid)}/package-changes/${enc(changeUid)}/cancel`,
    { method: 'POST', body: JSON.stringify(body) }),
};
