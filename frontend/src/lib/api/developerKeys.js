import { request } from '../api.js';

// D841 (#2464) — a member's own API keys for https://axal.vc/mcp, on
// routes/developer_keys.ts. Signed in with a session; every route is 404 while
// API_KEYS_ENABLED is off, which a page reads as "Not available yet". A key's
// secret comes back once, from create or rotate, and never from `list`.
//   list    GET  /developer/keys               keys (never a secret), scopes and companies available
//   create  POST /developer/keys               { name, scopes, companies, expires_in_days?, monthly_limit_microusd? } → { key, secret }
//   revoke  POST /developer/keys/:uid/revoke   → { key }
//   rotate  POST /developer/keys/:uid/rotate   → { key, secret, replaced }
//   limits  GET  /developer/limits             D849: the per-member, per-connection and per-key limits in force
const enc = encodeURIComponent;

export const developerKeysApi = {
  list: () => request('/developer/keys'),
  create: (body) => request('/developer/keys', { method: 'POST', body: JSON.stringify(body) }),
  revoke: (uid) => request(`/developer/keys/${enc(uid)}/revoke`, { method: 'POST' }),
  rotate: (uid) => request(`/developer/keys/${enc(uid)}/rotate`, { method: 'POST' }),
  limits: () => request('/developer/limits'),
};
