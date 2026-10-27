import { request } from '../api.js';

// D668 (#1498) — connecting an AI assistant (D665), on #1496's Worker routes
// (routes/mcp_consent.ts, D666). Every call is signed in; every route is 404
// while MCP_SERVER_ENABLED is off, which the pages read as "Not available yet".
//   assistantConsent         GET    /mcp/consent/:id           client, redirect host, scopes, grantable companies
//   approveAssistantConsent  POST   /mcp/consent/:id/approve   { companies } → { redirectTo }
//   denyAssistantConsent     POST   /mcp/consent/:id/deny      → { redirectTo } carrying access_denied
//   assistantGrants          GET    /connectors/assistants     the caller's grants (never a token)
//   revokeAssistantGrant     DELETE /connectors/assistants/:id
//   overview                 GET    /developer/assistants/overview  D1316: the server URL, scopes, tools, limits and
//                                   whether the caller can connect a company (Builder › MCP and services)
// D1316: each grant also carries scopes, verified_assistant and assistant_label, companies[].still_owned,
// last_call_at (with last_call_source) and calls_30d (null when the call log could not be read).
const enc = encodeURIComponent;

export const assistantsApi = {
  consent: (id) => request(`/mcp/consent/${enc(id)}`),
  approve: (id, companies) => request(`/mcp/consent/${enc(id)}/approve`, { method: 'POST', body: JSON.stringify({ companies }) }),
  deny: (id) => request(`/mcp/consent/${enc(id)}/deny`, { method: 'POST' }),
  grants: () => request('/connectors/assistants'),
  revoke: (grantId) => request(`/connectors/assistants/${enc(grantId)}`, { method: 'DELETE' }),
  overview: () => request('/developer/assistants/overview'),
};
