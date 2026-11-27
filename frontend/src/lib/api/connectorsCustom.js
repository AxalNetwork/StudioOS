// #9113 (g38, board C26) — a member's own remote MCP servers, D852's
// `/api/connectors/custom` (routes/connectors_custom.ts). Every route but
// `DELETE /:uid` answers 404 `custom_connectors_off` while the Worker's
// `CUSTOM_MCP_ENABLED` is off, and the Connectors page draws exactly what it
// drew before then.
//
//   GET    /connectors/custom                       list()
//   POST   /connectors/custom/start      { url }    start(url): { ok, uid, authorize_url }
//   GET    /connectors/custom/:uid/tools            tools(uid): descriptions are the server's words, untrusted
//   POST   /connectors/custom/:uid/tools/:name/approve   approveTool(uid, name)
//   DELETE /connectors/custom/:uid/tools/:name/approve   withdrawTool(uid, name)
//   POST   /connectors/custom/:uid/health           health(uid)
//   DELETE /connectors/custom/:uid                  revoke(uid): answers with the flag off too
//
// Not here: `GET /oauth/callback` is the browser's navigation, and D1343's
// `/:uid/tools/:name/mail-send` is drawn on no board.
//
// `inlinePaywall`: the plan's refusal (402) is drawn by the page's own
// upsell, so the global PaywallModal is not opened on top of it.
import { request } from '../api.js';

const enc = encodeURIComponent;
const BASE = '/connectors/custom';

export const connectorsCustomApi = {
  list: () => request(BASE, { inlinePaywall: true }),
  start: (url) => request(`${BASE}/start`, { method: 'POST', body: JSON.stringify({ url }), inlinePaywall: true }),
  tools: (uid) => request(`${BASE}/${enc(uid)}/tools`, { inlinePaywall: true }),
  approveTool: (uid, name) => request(`${BASE}/${enc(uid)}/tools/${enc(name)}/approve`, { method: 'POST', inlinePaywall: true }),
  withdrawTool: (uid, name) => request(`${BASE}/${enc(uid)}/tools/${enc(name)}/approve`, { method: 'DELETE', inlinePaywall: true }),
  health: (uid) => request(`${BASE}/${enc(uid)}/health`, { method: 'POST', inlinePaywall: true }),
  revoke: (uid) => request(`${BASE}/${enc(uid)}`, { method: 'DELETE', inlinePaywall: true }),
};
