/** HQ package term states and change review clients; Worker routes/admin_package_lifecycle.ts (#5025). */
import { request } from '../api.js';
const enc = encodeURIComponent;
export const packageLifecycleApi = {
  terms: (licenceUid) => request(`/admin/licences/${enc(licenceUid)}/package-terms`),
  changeReview: (licenceUid, offerUid, effectiveOn) => request(
    `/admin/licences/${enc(licenceUid)}/package-offers/${enc(offerUid)}/change-review${effectiveOn ? `?effective_on=${enc(effectiveOn)}` : ''}`),
};
