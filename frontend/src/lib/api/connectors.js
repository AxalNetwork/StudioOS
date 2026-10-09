// D651 (#1463) — the connectors service, D650's `/api/connectors`
// (routes/integrations.ts, which also still answers `/api/integrations` for
// the pages that call it there). The Connectors page, its sheet and Build's
// "Connect a tool" read and write through this module only.
//
// `inlinePaywall`: a connect or a sign-in start the plan refuses (402) is
// drawn by the sheet's own `pro` view, so the global PaywallModal is not
// opened on top of it.
import { request } from '../api.js';

const enc = encodeURIComponent;
const qs = (params = {}) => {
  const q = new URLSearchParams(Object.entries(params).filter(([, v]) => v != null && v !== '')).toString();
  return q ? `?${q}` : '';
};

export const connectorsApi = {
  available: () => request('/connectors/available'),
  list: () => request('/connectors'),
  waitlist: () => request('/connectors/waitlist'),
  notifyMe: (providerKey) => request('/connectors/notify-me', { method: 'POST', body: JSON.stringify({ provider_key: providerKey }) }),
  stopNotify: (providerKey) => request(`/connectors/notify-me/${enc(providerKey)}`, { method: 'DELETE' }),
  // Read for the caller's active company: the modules with no data yet, and
  // whether a teammate already connected this provider for that company.
  suggestions: () => request('/connectors/suggestions'),
  teammate: (key) => request(`/connectors/${enc(key)}`),
  sendRequest: (tool, use) => request('/connectors/requests', { method: 'POST', body: JSON.stringify({ tool, use }) }),
  connect: (data) => request('/connectors/connect', { method: 'POST', body: JSON.stringify(data), inlinePaywall: true }),
  oauthStart: (provider, params = {}) => request(`/connectors/oauth/${enc(provider)}/start${qs(params)}`, { inlinePaywall: true }),
  disconnect: (uid) => request(`/connectors/${enc(uid)}`, { method: 'DELETE' }),
  sync: (uid) => request(`/connectors/${enc(uid)}/sync`, { method: 'POST', inlinePaywall: true }),
  logs: (uid, params = {}) => request(`/connectors/${enc(uid)}/logs${qs(params)}`),
  setCompanies: (uid, companyIds) => request(`/connectors/${enc(uid)}/companies`, { method: 'PUT', body: JSON.stringify({ company_ids: companyIds }) }),
  fed: (uid) => request(`/connectors/${enc(uid)}/fed`),
  action: (uid, name, body) => request(`/connectors/${enc(uid)}/action/${enc(name)}`, body ? { method: 'POST', body: JSON.stringify(body) } : { method: 'GET' }),
  patchConfig: (uid, patch) => request(`/connectors/${enc(uid)}/config`, { method: 'PATCH', body: JSON.stringify(patch) }),
};
