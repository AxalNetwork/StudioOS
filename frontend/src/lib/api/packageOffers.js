/** HQ package offer review and atomic acceptance clients; Worker routes/admin_package_offers.ts (#5024). */
import { request } from '../api.js';
const enc = encodeURIComponent;
export const packageOffersApi = {
  list: (licenceUid) => request(`/admin/licences/${enc(licenceUid)}/package-offers`),
  create: (licenceUid, body) => request(`/admin/licences/${enc(licenceUid)}/package-offers`, { method: 'POST', body: JSON.stringify(body || {}) }),
  detail: (licenceUid, offerUid) => request(`/admin/licences/${enc(licenceUid)}/package-offers/${enc(offerUid)}`),
  history: (licenceUid, offerUid) => request(`/admin/licences/${enc(licenceUid)}/package-offers/${enc(offerUid)}/history`),
  review: (licenceUid, offerUid, body) => request(`/admin/licences/${enc(licenceUid)}/package-offers/${enc(offerUid)}/review`, { method: 'POST', body: JSON.stringify(body || {}) }),
  offer: (licenceUid, offerUid, body) => request(`/admin/licences/${enc(licenceUid)}/package-offers/${enc(offerUid)}/offer`, { method: 'POST', body: JSON.stringify(body || {}) }),
  accept: (licenceUid, offerUid, body) => request(`/admin/licences/${enc(licenceUid)}/package-offers/${enc(offerUid)}/accept`, { method: 'POST', body: JSON.stringify(body || {}) }),
  decline: (licenceUid, offerUid, body) => request(`/admin/licences/${enc(licenceUid)}/package-offers/${enc(offerUid)}/decline`, { method: 'POST', body: JSON.stringify(body || {}) }),
  expire: (licenceUid, offerUid, body) => request(`/admin/licences/${enc(licenceUid)}/package-offers/${enc(offerUid)}/expire`, { method: 'POST', body: JSON.stringify(body || {}) }),
  supersede: (licenceUid, offerUid, body) => request(`/admin/licences/${enc(licenceUid)}/package-offers/${enc(offerUid)}/supersede`, { method: 'POST', body: JSON.stringify(body || {}) }),
};
