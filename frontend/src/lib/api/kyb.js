// D1231: business verification. Staff reads; writes retain the shared step-up retry.
import { request } from '../api.js';
import { fetchKycDocument } from './kycPeople.js';
const ref = value => encodeURIComponent(value);
// The caller supplies the token returned by the case it displayed. Never refresh it silently.
const write = (path, body, method = 'PATCH') => {
  const { review_token, ...payload } = body || {};
  return request(path, { method, headers: review_token ? { 'If-Match': review_token } : {}, body: JSON.stringify(payload) });
};
export const kybApi = {
  list: (filters = {}) => request(`/kyc/businesses?${new URLSearchParams(Object.entries(filters).filter(([, v]) => v != null && v !== ''))}`),
  get: id => request(`/kyc/businesses/${ref(id)}`),
  owners: (id, body) => write(`/kyc/businesses/${ref(id)}/owners`, body, 'PUT'),
  approve: (id, body) => write(`/kyc/businesses/${ref(id)}/approve`, body),
  reject: (id, body) => write(`/kyc/businesses/${ref(id)}/reject`, body),
  requestDocuments: (id, body) => write(`/kyc/businesses/${ref(id)}/request-documents`, body),
  dismiss: (id, body) => write(`/kyc/businesses/${ref(id)}/dismiss`, body),
  linkAccount: (id, userId, reviewToken) => write(`/kyc/businesses/${ref(id)}/link-account`, { user_id: userId, review_token: reviewToken }),
  addStudio: body => write('/kyc/businesses/licensed-studios', body, 'POST'),
  uploadDocument: (id, body) => write(`/kyc/businesses/${ref(id)}/documents`, body, 'POST'),
  /** D1234: one document's bytes for the viewer inside the page; the Worker logs the view. */
  documentBlob: (id, documentId) => fetchKycDocument(`/api/kyc/businesses/${ref(id)}/documents/${ref(documentId)}`),
  sensitive: (id, field, index) => request(`/kyc/businesses/${ref(id)}/sensitive/${ref(field)}${index == null ? '' : `?index=${ref(index)}`}`),
};
