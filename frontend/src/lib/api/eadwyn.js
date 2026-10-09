// D652 (#1464) — the Worker AI rail's conversations and the connectors in
// them. Worker: routes/eadwyn.ts, mounted at /api/eadwyn. Every call is the
// caller's own; a conversation keeps the company that was active when it
// started.
import { request } from '../api.js';

const enc = encodeURIComponent;
const body = (b) => JSON.stringify(b ?? {});

export const eadwynApi = {
  // The "Connectors ›" list: each connection with the reason it cannot be used.
  connectors: () => request('/eadwyn/connectors'),
  conversations: (workspace) => request(`/eadwyn/conversations?workspace=${enc(workspace)}`),
  start: (workspace) => request('/eadwyn/conversations', { method: 'POST', body: body({ workspace }) }),
  conversation: (uid) => request(`/eadwyn/conversations/${enc(uid)}`),
  remove: (uid) => request(`/eadwyn/conversations/${enc(uid)}`, { method: 'DELETE' }),
  // The whole set of switches, every time: the Worker keeps exactly this list.
  setConnectors: (uid, keys) => request(`/eadwyn/conversations/${enc(uid)}/connectors`, {
    method: 'PUT', body: body({ keys }),
  }),
  // A model call, so the longer timeout `aiWorkspaceExplain` carries too.
  ask: (uid, { question, model, page, file }) => request(`/eadwyn/conversations/${enc(uid)}/ask`, {
    method: 'POST', timeoutMs: 60_000, body: body({ question, model, page, file }),
  }),
  // No body, on purpose: confirm sends what the Worker stored and showed.
  confirmAction: (uid) => request(`/eadwyn/actions/${enc(uid)}/confirm`, { method: 'POST' }),
  cancelAction: (uid) => request(`/eadwyn/actions/${enc(uid)}/cancel`, { method: 'POST' }),
};
