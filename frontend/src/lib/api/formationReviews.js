/** D6700 — HQ catalogue submissions and country-specific counsel decisions. */
import { request } from '../api.js';

const base = '/admin/formation/reviews';
const post = (path, body) => request(path, { method: 'POST', body: JSON.stringify(body) });
export const formationReviewsApi = {
  version: version => request(`${base}/versions/${encodeURIComponent(version)}`),
  submit: (version, body) => post(`${base}/versions/${encodeURIComponent(version)}/submit`, body),
  withdraw: (version, body) => post(`${base}/versions/${encodeURIComponent(version)}/withdraw`, body),
  publish: (version, body) => post(`${base}/versions/${encodeURIComponent(version)}/publish`, body),
  admissions: () => request(`${base}/admissions`),
  changeAdmission: body => post(`${base}/admissions`, body),
  assigned: () => request(`${base}/assigned`),
  review: id => request(`${base}/assigned/${encodeURIComponent(id)}`),
  decide: (id, body) => post(`${base}/assigned/${encodeURIComponent(id)}/decision`, body),
};
