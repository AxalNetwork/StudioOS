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
// D686 §5.4: Build acts for its project's company, which may not be the one
// chosen in the sidebar. `{ companyId }` sends it as the header the Worker
// reads (`X-Company-Id`, a claim it checks); without it the active one goes.
const co = (opts) => (opts?.companyId ? { headers: { 'X-Company-Id': String(opts.companyId) } } : {});
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
  suggestions: (opts) => request('/connectors/suggestions', co(opts)),
  teammate: (key, opts) => request(`/connectors/${enc(key)}`, co(opts)),
  sendRequest: (tool, use) => request('/connectors/requests', { method: 'POST', body: JSON.stringify({ tool, use }) }),
  connect: (data, opts) => request('/connectors/connect', { method: 'POST', body: JSON.stringify(data), inlinePaywall: true, ...co(opts) }),
  // The company is sealed into the sign-in's state at start, so a Build start sends the project's.
  oauthStart: (provider, params = {}, opts) => request(`/connectors/oauth/${enc(provider)}/start${qs(params)}`, { inlinePaywall: true, ...co(opts) }),
  disconnect: (uid) => request(`/connectors/${enc(uid)}`, { method: 'DELETE' }),
  sync: (uid, opts) => request(`/connectors/${enc(uid)}/sync`, { method: 'POST', inlinePaywall: true, ...co(opts) }),
  // D655's GitHub routes (D686 §5.4's sync view): the repositories the
  // installations reach and the chosen ones; the choice and its project; the
  // running sync's progress (written by the sync itself, inside its request).
  repositories: (uid, opts) => request(`/connectors/${enc(uid)}/repositories`, co(opts)),
  setRepositories: (uid, repositories, projectId, opts) => request(`/connectors/${enc(uid)}/repositories`, {
    method: 'PUT', body: JSON.stringify({ repositories, project_id: projectId }), ...co(opts),
  }),
  syncStatus: (uid) => request(`/connectors/${enc(uid)}/sync-status`),
  logs: (uid, params = {}) => request(`/connectors/${enc(uid)}/logs${qs(params)}`),
  setCompanies: (uid, companyIds) => request(`/connectors/${enc(uid)}/companies`, { method: 'PUT', body: JSON.stringify({ company_ids: companyIds }) }),
  fed: (uid) => request(`/connectors/${enc(uid)}/fed`),
  action: (uid, name, body) => request(`/connectors/${enc(uid)}/action/${enc(name)}`, body ? { method: 'POST', body: JSON.stringify(body) } : { method: 'GET' }),
  patchConfig: (uid, patch) => request(`/connectors/${enc(uid)}/config`, { method: 'PATCH', body: JSON.stringify(patch) }),
};
