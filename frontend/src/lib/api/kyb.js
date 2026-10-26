// D1231: business verification. Staff reads; writes retain the shared step-up retry.
import { request } from '../api.js';
const ref = value => encodeURIComponent(value);
const write = (path, body, method = 'PATCH') => request(path, { method, body: JSON.stringify(body) });
export const kybApi = {
  list: (filters = {}) => request(`/kyc/businesses?${new URLSearchParams(Object.entries(filters).filter(([, v]) => v != null && v !== ''))}`),
  get: id => request(`/kyc/businesses/${ref(id)}`),
  owners: (id, body) => write(`/kyc/businesses/${ref(id)}/owners`, body, 'PUT'),
  approve: (id, body) => write(`/kyc/businesses/${ref(id)}/approve`, body),
  reject: (id, body) => write(`/kyc/businesses/${ref(id)}/reject`, body),
  requestDocuments: (id, body) => write(`/kyc/businesses/${ref(id)}/request-documents`, body),
  dismiss: (id, body) => write(`/kyc/businesses/${ref(id)}/dismiss`, body),
  linkAccount: (id, userId) => write(`/kyc/businesses/${ref(id)}/link-account`, { user_id: userId }),
  addStudio: body => write('/kyc/businesses/licensed-studios', body, 'POST'),
  uploadDocument: (id, body) => write(`/kyc/businesses/${ref(id)}/documents`, body, 'POST'),
  sensitive: (id, field, index) => request(`/kyc/businesses/${ref(id)}/sensitive/${ref(field)}${index == null ? '' : `?index=${ref(index)}`}`),
};
